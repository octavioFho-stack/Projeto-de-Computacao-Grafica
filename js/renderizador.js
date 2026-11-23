/*
  renderizador.js
  Pipeline WebGL2 seguindo o procedimento da secao 3.3 de Everitt & Kilgard:

   1. Limpa cor, profundidade e stencil.
   2. Projecao Pinf (plano distante no infinito).
   3. Passe AMBIENTE: desenha a cena so com luz ambiente, gravando profundidade.
   4. Para cada luz:
      a. limpa o stencil;
      b. desenha os volumes de sombra so no stencil (cor e profundidade travadas);
         - Z-FAIL: face de frente  -> DECR_WRAP quando o teste de profundidade falha
                   face de costas  -> INCR_WRAP quando o teste de profundidade falha
                   (precisa das tampas: volume fechado)
         - Z-PASS: face de frente  -> INCR_WRAP quando passa
                   face de costas  -> DECR_WRAP quando passa
                   (sem tampas; falha quando a camera esta dentro do volume)
      c. passe de LUZ: soma (blend ONE, ONE) a contribuicao da luz apenas onde
         stencil == 0 e com depthFunc EQUAL (so nos fragmentos visiveis).
   Stencil de dois lados (stencilOpSeparate) desenha os volumes em uma passada (sec. 4.3)
   e as operacoes com "wrap" evitam saturacao do contador (sec. 4.1).
*/
'use strict';

const SHADER_VERTICE_CENA = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
out vec3 vWorldPos;
out vec3 vNormal;
invariant gl_Position;   // mesma profundidade nos passes ambiente e de luz (depthFunc EQUAL)
void main() {
    vWorldPos = (uModel * vec4(aPos, 1.0)).xyz;
    vNormal = mat3(uModel) * aNormal;
    gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const SHADER_FRAGMENTO_CENA = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vNormal;
uniform int uModo;            // 1 = ambiente, 0 = luz de um farol
uniform vec3 uCor;
uniform float uAmbiente;
uniform vec3 uEmissivo;
uniform vec3 uLuzPos;
uniform vec3 uLuzDir;
uniform vec3 uLuzCor;
uniform float uCorteInterno;  // cos do angulo interno do cone
uniform float uCorteExterno;  // cos do angulo externo do cone
uniform float uAtenuacao;
uniform float uPotencia;
uniform float uAlcance;
out vec4 fragColor;
void main() {
    if (uModo == 1) {
        fragColor = vec4(uCor * uAmbiente + uEmissivo, 1.0);
        return;
    }
    vec3 paraLuz = uLuzPos - vWorldPos;
    float d = length(paraLuz);
    vec3 L = paraLuz / d;
    float theta = dot(-L, uLuzDir);
    float cone = clamp((theta - uCorteExterno) / (uCorteInterno - uCorteExterno), 0.0, 1.0);
    float aten = 1.0 / (1.0 + uAtenuacao * d * d);
    float alcance = 1.0 - smoothstep(uAlcance * 0.7, uAlcance, d);  // zero alem do alcance
    float difusa = max(dot(normalize(vNormal), L), 0.0);
    vec3 luz = uPotencia * uLuzCor * difusa * aten * cone * alcance;
    fragColor = vec4(uCor * luz + luz * 0.15, 1.0);
}`;

const SHADER_VERTICE_SOMBRA = `#version 300 es
layout(location = 0) in vec4 aPos;   // w = 1: ponto finito, w = 0: ponto no infinito
uniform mat4 uMVP;
void main() {
    gl_Position = uMVP * aPos;
}`;

const SHADER_FRAGMENTO_SOMBRA = `#version 300 es
precision mediump float;
uniform vec4 uCor;
out vec4 fragColor;
void main() {
    fragColor = uCor;
}`;

class Renderizador {
    constructor(canvas) {
        this.canvas = canvas;
        // antialias desligado: o custo por pixel (fill rate) fica proporcional a resolucao
        const gl = canvas.getContext('webgl2', { stencil: true, antialias: false, depth: true });
        if (!gl) throw new Error('WebGL2 nao esta disponivel neste navegador.');
        this.gl = gl;

        this.bitsStencil = gl.getParameter(gl.STENCIL_BITS);
        this.extTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        this.consultasPendentes = [];
        this.consultasLivres = [];

        this.progCena = this._criaPrograma(SHADER_VERTICE_CENA, SHADER_FRAGMENTO_CENA);
        this.progSombra = this._criaPrograma(SHADER_VERTICE_SOMBRA, SHADER_FRAGMENTO_SOMBRA);
        this.uCena = this._uniforms(this.progCena, ['uMVP', 'uModel', 'uModo', 'uCor', 'uAmbiente', 'uEmissivo',
            'uLuzPos', 'uLuzDir', 'uLuzCor', 'uCorteInterno', 'uCorteExterno', 'uAtenuacao', 'uPotencia', 'uAlcance']);
        this.uSombra = this._uniforms(this.progSombra, ['uMVP', 'uCor']);

        // Buffers do cubo (estaticos)
        this.vaoCena = gl.createVertexArray();
        gl.bindVertexArray(this.vaoCena);
        const vboPos = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cuboVertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        const vboNorm = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vboNorm);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cuboNormais), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        const ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(cuboIndices), gl.STATIC_DRAW);
        this.bytesEstaticos = (cuboVertices.length + cuboNormais.length) * 4 + cuboIndices.length * 2;

        // Buffer dos volumes de sombra (dinamico, refeito a cada quadro)
        this.vaoSombra = gl.createVertexArray();
        gl.bindVertexArray(this.vaoSombra);
        this.vboSombra = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboSombra);
        this.capacidadeSombra = 1 << 20;
        gl.bufferData(gl.ARRAY_BUFFER, this.capacidadeSombra, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        this.construtor = new ConstrutorVolumes();
        this.largura = 0;
        this.altura = 0;
    }

    _criaShader(tipo, fonte) {
        const gl = this.gl;
        const s = gl.createShader(tipo);
        gl.shaderSource(s, fonte);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error('Erro no shader: ' + gl.getShaderInfoLog(s));
        }
        return s;
    }

    _criaPrograma(vs, fs) {
        const gl = this.gl;
        const p = gl.createProgram();
        gl.attachShader(p, this._criaShader(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, this._criaShader(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            throw new Error('Erro ao ligar o programa: ' + gl.getProgramInfoLog(p));
        }
        return p;
    }

    _uniforms(prog, nomes) {
        const u = {};
        for (const n of nomes) u[n] = this.gl.getUniformLocation(prog, n);
        return u;
    }

    // Resolucao interna = tamanho na tela x escala (o benchmark varia a escala)
    ajustaResolucao(escala) {
        const w = Math.max(1, Math.round(this.canvas.clientWidth * escala));
        const h = Math.max(1, Math.round(this.canvas.clientHeight * escala));
        if (w !== this.canvas.width || h !== this.canvas.height) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        this.largura = w;
        this.altura = h;
    }

    // ---------------- Tempo de GPU (EXT_disjoint_timer_query_webgl2) ----------------
    iniciaMedicaoGPU(etiqueta) {
        if (!this.extTimer) return;
        const gl = this.gl;
        const q = this.consultasLivres.pop() || gl.createQuery();
        gl.beginQuery(this.extTimer.TIME_ELAPSED_EXT, q);
        this._consultaAtual = { q: q, etiqueta: etiqueta };
    }

    finalizaMedicaoGPU() {
        if (!this.extTimer || !this._consultaAtual) return;
        this.gl.endQuery(this.extTimer.TIME_ELAPSED_EXT);
        this.consultasPendentes.push(this._consultaAtual);
        this._consultaAtual = null;
    }

    // Resultados chegam alguns quadros depois; devolve [{ms, etiqueta}]
    coletaMedicoesGPU() {
        const saida = [];
        if (!this.extTimer) return saida;
        const gl = this.gl;
        const disjunto = gl.getParameter(this.extTimer.GPU_DISJOINT_EXT);
        while (this.consultasPendentes.length) {
            const c = this.consultasPendentes[0];
            if (!gl.getQueryParameter(c.q, gl.QUERY_RESULT_AVAILABLE)) break;
            const ns = gl.getQueryParameter(c.q, gl.QUERY_RESULT);
            this.consultasPendentes.shift();
            this.consultasLivres.push(c.q);
            if (!disjunto) saida.push({ ms: ns / 1e6, etiqueta: c.etiqueta });
        }
        return saida;
    }

    // Memoria de video estimada: buffers + framebuffer (cor RGBA8 x2 + profundidade/stencil 32 bits)
    memoriaEstimadaBytes() {
        return this.bytesEstaticos + this.capacidadeSombra + this.largura * this.altura * (4 * 2 + 4);
    }

    // ---------------- Desenho ----------------
    _desenhaObjetos(objetos, ambiente) {
        const gl = this.gl, u = this.uCena;
        for (const o of objetos) {
            gl.uniformMatrix4fv(u.uMVP, false, o.mvp);
            gl.uniformMatrix4fv(u.uModel, false, o.matriz);
            gl.uniform3fv(u.uCor, o.cor);
            if (ambiente) {
                gl.uniform1f(u.uAmbiente, o.ambiente);
                gl.uniform3fv(u.uEmissivo, o.emissivo);
            }
            gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
            this.est.drawCalls++;
        }
    }

    /*
      cena = {
        objetos:   [{ matriz, cor, ambiente, emissivo }],
        luzes:     [{ pos, dir, cor, cosInterno, cosExterno, anguloExterno, atenuacao, potencia, alcance, dono }],
        oclusores: [{ cantos, normais, obb, esfera, dono }],
        matrizVisao, metodo ('zfail' | 'zpass'), culling (bool), mostrarVolumes (bool)
      }
      Retorna estatisticas do quadro.
    */
    renderiza(cena) {
        const gl = this.gl;
        const est = this.est = {
            drawCalls: 0, triangulosSombra: 0, bytesVolumes: 0, luzes: cena.luzes.length,
            oclusoresProcessados: 0, oclusoresPossiveis: 0, msVolumes: 0, msDesenho: 0
        };
        const t0 = performance.now();

        gl.viewport(0, 0, this.largura, this.altura);
        gl.clearColor(0.01, 0.01, 0.015, 1.0);
        gl.clearStencil(0);
        gl.depthMask(true);
        gl.colorMask(true, true, true, true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

        const projecao = Matriz4.perspectivaInfinita(Math.PI / 3.5, this.largura / this.altura, 0.1);
        const vp = Matriz4.multiplica(projecao, cena.matrizVisao);
        for (const o of cena.objetos) o.mvp = Matriz4.multiplica(vp, o.matriz);

        // ===== Passe ambiente =====
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.disable(gl.BLEND);
        gl.disable(gl.STENCIL_TEST);
        gl.useProgram(this.progCena);
        gl.bindVertexArray(this.vaoCena);
        gl.uniform1i(this.uCena.uModo, 1);
        this._desenhaObjetos(cena.objetos, true);

        if (cena.luzes.length > 0) {
            // ===== Geracao dos volumes de sombra (CPU) =====
            const tv = performance.now();
            const cv = this.construtor;
            cv.limpa();
            const faixas = [];
            for (const luz of cena.luzes) {
                cv.iniciaLuz();
                for (const ocl of cena.oclusores) {
                    if (ocl.dono === luz.dono) continue; // o carro nao faz sombra no proprio farol
                    est.oclusoresPossiveis++;
                    if (cena.culling && !oclusorAfetaLuz(ocl, luz)) continue;
                    cv.adicionaOclusor(ocl, luz.pos);
                    est.oclusoresProcessados++;
                }
                faixas.push(cv.finalizaLuz());
            }
            gl.bindVertexArray(this.vaoSombra);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vboSombra);
            const bytes = cv.usados * 4;
            if (bytes > this.capacidadeSombra) {
                while (this.capacidadeSombra < bytes) this.capacidadeSombra *= 2;
                gl.bufferData(gl.ARRAY_BUFFER, this.capacidadeSombra, gl.DYNAMIC_DRAW);
            }
            if (bytes > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, cv.dados, 0, cv.usados);
            est.bytesVolumes = bytes;
            est.msVolumes = performance.now() - tv;

            // ===== Um passe de stencil + um passe de luz para cada farol =====
            gl.depthMask(false);
            gl.enable(gl.STENCIL_TEST);
            gl.stencilMask(0xFF);
            const zfail = cena.metodo === 'zfail';

            for (let i = 0; i < cena.luzes.length; i++) {
                const luz = cena.luzes[i];
                const f = faixas[i];
                const nVert = zfail ? (f.verticesLados + f.verticesTampas) : f.verticesLados;
                est.triangulosSombra += nVert / 3;

                // a) limpa o stencil
                gl.clear(gl.STENCIL_BUFFER_BIT);

                // b) volumes so no stencil
                gl.useProgram(this.progSombra);
                gl.bindVertexArray(this.vaoSombra);
                gl.uniformMatrix4fv(this.uSombra.uMVP, false, vp);
                gl.colorMask(false, false, false, false);
                gl.disable(gl.CULL_FACE);
                gl.depthFunc(gl.LESS);
                gl.stencilFunc(gl.ALWAYS, 0, 0xFF);
                if (zfail) {
                    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.DECR_WRAP, gl.KEEP);
                    gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.INCR_WRAP, gl.KEEP);
                } else {
                    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
                    gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
                }
                if (nVert > 0) {
                    gl.drawArrays(gl.TRIANGLES, f.primeiroVertice, nVert);
                    est.drawCalls++;
                }

                // c) passe de luz onde stencil == 0
                gl.useProgram(this.progCena);
                gl.bindVertexArray(this.vaoCena);
                gl.colorMask(true, true, true, true);
                gl.enable(gl.CULL_FACE);
                gl.stencilFunc(gl.EQUAL, 0, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
                gl.depthFunc(gl.EQUAL);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ONE);
                const u = this.uCena;
                gl.uniform1i(u.uModo, 0);
                gl.uniform3fv(u.uLuzPos, luz.pos);
                gl.uniform3fv(u.uLuzDir, luz.dir);
                gl.uniform3fv(u.uLuzCor, luz.cor);
                gl.uniform1f(u.uCorteInterno, luz.cosInterno);
                gl.uniform1f(u.uCorteExterno, luz.cosExterno);
                gl.uniform1f(u.uAtenuacao, luz.atenuacao);
                gl.uniform1f(u.uPotencia, luz.potencia);
                gl.uniform1f(u.uAlcance, luz.alcance);
                this._desenhaObjetos(cena.objetos, false);
                gl.disable(gl.BLEND);
                gl.depthFunc(gl.LESS);
            }
            gl.disable(gl.STENCIL_TEST);

            // ===== Visualizacao dos volumes (apresentacao) =====
            if (cena.mostrarVolumes && cv.usados > 0) {
                gl.useProgram(this.progSombra);
                gl.bindVertexArray(this.vaoSombra);
                gl.uniformMatrix4fv(this.uSombra.uMVP, false, vp);
                gl.uniform4f(this.uSombra.uCor, 1.0, 0.25, 0.2, 0.12);
                gl.disable(gl.CULL_FACE);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                for (const f of faixas) {
                    const n = zfail ? (f.verticesLados + f.verticesTampas) : f.verticesLados;
                    if (n > 0) { gl.drawArrays(gl.TRIANGLES, f.primeiroVertice, n); est.drawCalls++; }
                }
                gl.disable(gl.BLEND);
            }
            gl.depthMask(true);
        }
        gl.bindVertexArray(null);
        est.msDesenho = performance.now() - t0 - est.msVolumes;
        return est;
    }
}
