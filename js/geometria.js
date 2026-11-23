/*
  geometria.js
  - Malha do cubo usada para desenhar (24 vertices com normais por face).
  - Topologia do cubo usada para as sombras (8 cantos, 12 triangulos e a lista
    de adjacencia das 18 arestas, pre-calculada uma unica vez).
  - Oclusores (objetos que projetam sombra) e o construtor dos volumes de sombra
    seguindo a secao 3.2.2 de Everitt & Kilgard.
*/
'use strict';

// ---------------------------------------------------------------------------
// Malha de desenho (cubo unitario de -1 a 1, faces CCW vistas de fora)
// ---------------------------------------------------------------------------
const cuboVertices = [
    -1,-1,1, 1,-1,1, 1,1,1, -1,1,1,  -1,-1,-1, -1,1,-1, 1,1,-1, 1,-1,-1,
    -1,1,-1, -1,1,1, 1,1,1, 1,1,-1,  -1,-1,-1, 1,-1,-1, 1,-1,1, -1,-1,1,
    1,-1,-1, 1,1,-1, 1,1,1, 1,-1,1,  -1,-1,-1, -1,-1,1, -1,1,1, -1,1,-1
];
const cuboNormais = [
    0,0,1, 0,0,1, 0,0,1, 0,0,1,  0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    0,1,0, 0,1,0, 0,1,0, 0,1,0,  0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
    1,0,0, 1,0,0, 1,0,0, 1,0,0,  -1,0,0, -1,0,0, -1,0,0, -1,0,0
];
const cuboIndices = [
    0,1,2, 0,2,3, 4,5,6, 4,6,7, 8,9,10, 8,10,11,
    12,13,14, 12,14,15, 16,17,18, 16,18,19, 20,21,22, 20,22,23
];

// ---------------------------------------------------------------------------
// Topologia para os volumes de sombra
// Requisito do artigo (secao 3.1): malha fechada (2-manifold), so triangulos,
// ordem de vertices consistente e informacao de conectividade disponivel.
// ---------------------------------------------------------------------------

// Canto i: bit 0 -> x, bit 1 -> y, bit 2 -> z  (0 = -1, 1 = +1)
const CUBO_CANTOS_LOCAIS = [];
for (let i = 0; i < 8; i++) {
    CUBO_CANTOS_LOCAIS.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1]);
}

// Gera os 12 triangulos garantindo ordem anti-horaria vista de fora (normal para fora)
const CUBO_TRIANGULOS = (function () {
    const faces = [
        [0, 4, 6, 2], [1, 3, 7, 5],   // x = -1, x = +1
        [0, 1, 5, 4], [2, 6, 7, 3],   // y = -1, y = +1
        [0, 2, 3, 1], [4, 5, 7, 6]    // z = -1, z = +1
    ];
    const tris = [];
    for (let f of faces) {
        let p = f.map(i => CUBO_CANTOS_LOCAIS[i]);
        let normal = Vetor3.produtoVetorial(Vetor3.subtrai(p[1], p[0]), Vetor3.subtrai(p[2], p[0]));
        let centro = Vetor3.escala(Vetor3.soma(Vetor3.soma(p[0], p[1]), Vetor3.soma(p[2], p[3])), 0.25);
        if (Vetor3.produtoEscalar(normal, centro) < 0) {
            f = [f[0], f[3], f[2], f[1]]; // inverte para apontar para fora
        }
        tris.push(f[0], f[1], f[2], f[0], f[2], f[3]);
    }
    return tris;
})();

// Lista de adjacencia: cada aresta conhece os dois triangulos que a compartilham.
// a -> b eh a ordem da aresta dentro do triangulo t1 (em t2 ela aparece como b -> a).
const CUBO_ARESTAS = (function () {
    const mapa = new Map();
    const arestas = [];
    for (let t = 0; t < 12; t++) {
        for (let j = 0; j < 3; j++) {
            let a = CUBO_TRIANGULOS[t * 3 + j];
            let b = CUBO_TRIANGULOS[t * 3 + (j + 1) % 3];
            let chave = Math.min(a, b) + '-' + Math.max(a, b);
            if (mapa.has(chave)) {
                mapa.get(chave).t2 = t;
            } else {
                let aresta = { a: a, b: b, t1: t, t2: -1 };
                mapa.set(chave, aresta);
                arestas.push(aresta);
            }
        }
    }
    return arestas;
})();

// ---------------------------------------------------------------------------
// Oclusor: um paralelepipedo (predio, chassi ou cabine) que projeta sombra
// ---------------------------------------------------------------------------
function criaOclusor(matriz, dono) {
    let ocl = {
        dono: (dono === undefined) ? -1 : dono, // id do carro dono (-1 = predio)
        matriz: null,
        cantos: [],
        normais: [],
        obb: null,
        esfera: { c: [0, 0, 0], r: 0 }
    };
    atualizaOclusor(ocl, matriz);
    return ocl;
}

// Recalcula cantos no mundo, normais dos triangulos, OBB e esfera envolvente
function atualizaOclusor(ocl, matriz) {
    ocl.matriz = matriz;
    for (let i = 0; i < 8; i++) {
        ocl.cantos[i] = Matriz4.transformaPonto(matriz, CUBO_CANTOS_LOCAIS[i]);
    }
    for (let t = 0; t < 12; t++) {
        let p0 = ocl.cantos[CUBO_TRIANGULOS[t * 3]];
        let p1 = ocl.cantos[CUBO_TRIANGULOS[t * 3 + 1]];
        let p2 = ocl.cantos[CUBO_TRIANGULOS[t * 3 + 2]];
        ocl.normais[t] = Vetor3.produtoVetorial(Vetor3.subtrai(p1, p0), Vetor3.subtrai(p2, p0));
    }
    ocl.obb = OBB.deMatriz(matriz);
    ocl.esfera.c = ocl.obb.c;
    ocl.esfera.r = Vetor3.tamanho(ocl.obb.e);
}

// ---------------------------------------------------------------------------
// Construtor dos volumes de sombra (Everitt & Kilgard, secao 3.2.2)
//
// O volume fechado de cada oclusor eh formado por:
//   (1) arestas de possivel silhueta extrudadas ate o infinito (w = 0);
//   (2) tampa proxima: triangulos de costas para a luz, na posicao original;
//   (3) tampa distante: os mesmos triangulos projetados ate o infinito (w = 0).
// O artigo usa as faces de frente para a luz como tampa proxima. Usar as faces de
// costas fecha o mesmo tipo de volume (ele comeca no lado escuro do objeto) e evita
// que a tampa coincida com faces iluminadas e visiveis, o que causaria "z-fighting"
// com pontos de sombra falsa. As faces de costas nunca recebem luz (N.L <= 0).
//
// Todos os triangulos saem com a normal apontando para FORA do volume, entao as
// faces de frente/costas vistas pela camera equivalem a entrar/sair da sombra.
// ---------------------------------------------------------------------------
class ConstrutorVolumes {
    constructor() {
        this.dados = new Float32Array(1 << 16);   // todos os volumes do quadro
        this.usados = 0;
        this.lados = new Float32Array(1 << 14);   // temporario de uma luz
        this.nLados = 0;
        this.tampas = new Float32Array(1 << 14);
        this.nTampas = 0;
        this.iluminado = new Uint8Array(12);
    }

    limpa() {
        this.usados = 0;
    }

    static _garante(vetor, necessario) {
        if (necessario <= vetor.length) return vetor;
        let novo = new Float32Array(Math.max(necessario, vetor.length * 2));
        novo.set(vetor);
        return novo;
    }

    // Comeca o volume de uma luz
    iniciaLuz() {
        this.nLados = 0;
        this.nTampas = 0;
    }

    _ladoPonto(p, w, L) {
        let v = this.lados, i = this.nLados;
        if (w === 1) { v[i] = p[0]; v[i + 1] = p[1]; v[i + 2] = p[2]; v[i + 3] = 1; }
        else { v[i] = p[0] - L[0]; v[i + 1] = p[1] - L[1]; v[i + 2] = p[2] - L[2]; v[i + 3] = 0; }
        this.nLados += 4;
    }

    _tampaPonto(p, w, L) {
        let v = this.tampas, i = this.nTampas;
        if (w === 1) { v[i] = p[0]; v[i + 1] = p[1]; v[i + 2] = p[2]; v[i + 3] = 1; }
        else { v[i] = p[0] - L[0]; v[i + 1] = p[1] - L[1]; v[i + 2] = p[2] - L[2]; v[i + 3] = 0; }
        this.nTampas += 4;
    }

    // Adiciona o volume de sombra de um oclusor para a luz pontual L
    adicionaOclusor(ocl, L) {
        this.lados = ConstrutorVolumes._garante(this.lados, this.nLados + 18 * 6 * 4);
        this.tampas = ConstrutorVolumes._garante(this.tampas, this.nTampas + 12 * 6 * 4);

        const P = ocl.cantos;
        const ilum = this.iluminado;

        // Classifica cada triangulo como de frente (1) ou de costas (0) para a luz
        for (let t = 0; t < 12; t++) {
            let n = ocl.normais[t];
            let p = P[CUBO_TRIANGULOS[t * 3]];
            let d = n[0] * (L[0] - p[0]) + n[1] * (L[1] - p[1]) + n[2] * (L[2] - p[2]);
            ilum[t] = d > 0 ? 1 : 0;
        }

        // Tampas: proxima (ordem invertida) e no infinito (ordem original)
        for (let t = 0; t < 12; t++) {
            if (ilum[t]) continue;
            let a = P[CUBO_TRIANGULOS[t * 3]];
            let b = P[CUBO_TRIANGULOS[t * 3 + 1]];
            let c = P[CUBO_TRIANGULOS[t * 3 + 2]];
            this._tampaPonto(c, 1, L); this._tampaPonto(b, 1, L); this._tampaPonto(a, 1, L);
            this._tampaPonto(a, 0, L); this._tampaPonto(b, 0, L); this._tampaPonto(c, 0, L);
        }

        // Lados: arestas de possivel silhueta (um triangulo de frente e outro de costas).
        // A e B ficam na ordem em que aparecem no triangulo de costas.
        for (let k = 0; k < CUBO_ARESTAS.length; k++) {
            let ar = CUBO_ARESTAS[k];
            if (ilum[ar.t1] === ilum[ar.t2]) continue;
            let A, B;
            if (!ilum[ar.t1]) { A = P[ar.a]; B = P[ar.b]; }
            else { A = P[ar.b]; B = P[ar.a]; }
            // Quad A, B, B_inf, A_inf em dois triangulos
            this._ladoPonto(A, 1, L); this._ladoPonto(B, 1, L); this._ladoPonto(B, 0, L);
            this._ladoPonto(A, 1, L); this._ladoPonto(B, 0, L); this._ladoPonto(A, 0, L);
        }
    }

    // Copia lados + tampas desta luz para o buffer do quadro.
    // Layout: [lados][tampas], para o Z-Pass desenhar so os lados.
    finalizaLuz() {
        let total = this.nLados + this.nTampas;
        this.dados = ConstrutorVolumes._garante(this.dados, this.usados + total);
        let inicio = this.usados / 4;
        this.dados.set(this.lados.subarray(0, this.nLados), this.usados);
        this.dados.set(this.tampas.subarray(0, this.nTampas), this.usados + this.nLados);
        this.usados += total;
        return {
            primeiroVertice: inicio,
            verticesLados: this.nLados / 4,
            verticesTampas: this.nTampas / 4
        };
    }
}

// Teste conservador de culling: o oclusor pode afetar a luz?
// Uma sombra so existe dentro do cone e do alcance da luz, entao um oclusor cuja
// esfera envolvente esta fora do cone (ou alem do alcance) nao muda a imagem final.
function oclusorAfetaLuz(ocl, luz) {
    let v = Vetor3.subtrai(ocl.esfera.c, luz.pos);
    let d = Vetor3.tamanho(v);
    let r = ocl.esfera.r;
    if (d - r > luz.alcance) return false;
    if (d <= r) return true;
    let cosAng = Vetor3.produtoEscalar(v, luz.dir) / d;
    let ang = Math.acos(Math.max(-1, Math.min(1, cosAng)));
    return ang <= luz.anguloExterno + Math.asin(r / d);
}
