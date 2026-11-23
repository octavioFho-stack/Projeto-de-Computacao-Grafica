/*
  cena.js
  Cidade (grade de quarteiroes com predios), carros e a simulacao de movimento.

  Os carros usam steering behaviors (Reynolds, GDC 1999):
  - seek/arrive: buscam o proximo ponto do caminho e reduzem a velocidade antes das curvas;
  - desvio de obstaculos: um sensor (OBB a frente do carro) consulta a OBBTree dos
    predios e gera uma forca lateral de afastamento;
  - frenagem: se o sensor sobrepoe outro carro, a velocidade desejada vai a zero;
  - reserva de cruzamento: so um carro por vez em cada cruzamento, e so se houver
    espaco na rua de saida (os outros fazem arrive ate parar antes da faixa).
  A deteccao de colisao do corpo do carro tambem usa a OBBTree.
*/
'use strict';

const DISTANCIA_QUADRAS = 6;      // distancia entre centros de quarteiroes
const MEIA_LARGURA_PREDIO = 1.8;  // rua resultante: 6 - 2*1.8 = 2.4 de largura
const DESLOCAMENTO_FAIXA = 0.55;  // mao direita: distancia do centro da rua
const PASSO_SIMULACAO = 1 / 60;   // passo fixo (segundos)

const CARRO_VEL_MAX = 1.5;        // unidades por segundo
const CARRO_FORCA_MAX = 6.0;      // aceleracao maxima de steering
const CARRO_MASSA = 0.15;         // massa (define a rapidez da resposta do steering)
const CARRO_MEIO_COMPR = 0.75;
const CARRO_MEIA_LARG = 0.45;

const DIRECOES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Configuracao dos farois (cada carro tem 2 luzes pontuais)
const CONFIG_FAROIS = {
    1: { nome: 'Farol Baixo', interno: 14, externo: 24, atenuacao: 0.08, potencia: 4.0, alcance: 14, inclinacao: 0.10 },
    2: { nome: 'Farol Alto', interno: 20, externo: 36, atenuacao: 0.015, potencia: 9.0, alcance: 26, inclinacao: 0.03 }
};
const COR_FAROL = [1.0, 0.93, 0.78];

// Vetor "a direita" no plano XZ para uma direcao (x, z) com Y para cima
function direitaDe(d) {
    return [-d[1], d[0]];
}

class Cidade {
    constructor(n, semente) {
        const rng = criaGeradorAleatorio(semente);
        this.n = n;
        this.extensao = n * DISTANCIA_QUADRAS / 2;
        this.ruas = [];
        for (let k = 0; k <= n; k++) this.ruas.push(-this.extensao + k * DISTANCIA_QUADRAS);

        let meioChao = this.extensao + 1.5;
        this.chao = {
            matriz: Matriz4.translacaoEscala(0, -0.5, 0, meioChao, 0.5, meioChao),
            cor: [0.2, 0.2, 0.22]
        };

        this.predios = [];
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                let cx = this.ruas[i] + DISTANCIA_QUADRAS / 2;
                let cz = this.ruas[j] + DISTANCIA_QUADRAS / 2;
                let meiaAltura = 0.75 + rng() * 1.5;
                let matriz = Matriz4.translacaoEscala(cx, meiaAltura, cz, MEIA_LARGURA_PREDIO, meiaAltura, MEIA_LARGURA_PREDIO);
                let tom = rng() * 0.06;
                this.predios.push({
                    matriz: matriz,
                    cor: [0.13 + tom, 0.19 + tom, 0.27 + tom],
                    oclusor: criaOclusor(matriz, -1)
                });
            }
        }

        // OBBTree dos predios (estatica: construida uma vez)
        this.arvore = constroiOBBTree(this.predios.map(p => ({
            obb: p.oclusor.obb,
            pontos: p.oclusor.cantos,
            centro: p.oclusor.obb.c,
            predio: p
        })));
        this.profundidadeArvore = Cidade._profundidade(this.arvore);
    }

    static _profundidade(no) {
        if (no.item) return no.profundidade;
        return Math.max(Cidade._profundidade(no.esq), Cidade._profundidade(no.dir));
    }

    posicaoNo(ix, iz) {
        return [this.ruas[ix], this.ruas[iz]];
    }

    noValido(ix, iz) {
        return ix >= 0 && iz >= 0 && ix <= this.n && iz <= this.n;
    }

    // Ponto onde o carro faz a conversao no cruzamento: interseccao da faixa de
    // chegada (direcao dEntrada) com a faixa de saida (direcao dSaida).
    pontoDeConversao(ix, iz, dEntrada, dSaida) {
        let p = this.posicaoNo(ix, iz);
        let r1 = direitaDe(dEntrada);
        let x = p[0] + r1[0] * DESLOCAMENTO_FAIXA;
        let z = p[1] + r1[1] * DESLOCAMENTO_FAIXA;
        if (dSaida[0] !== dEntrada[0] || dSaida[1] !== dEntrada[1]) {
            let r2 = direitaDe(dSaida);
            x += r2[0] * DESLOCAMENTO_FAIXA;
            z += r2[1] * DESLOCAMENTO_FAIXA;
        }
        return [x, z];
    }

    // Todos os trechos de rua entre cruzamentos vizinhos (para posicionar carros)
    trechos() {
        let lista = [];
        for (let ix = 0; ix <= this.n; ix++) {
            for (let iz = 0; iz <= this.n; iz++) {
                if (ix < this.n) lista.push({ ix: ix, iz: iz, d: [1, 0] });
                if (iz < this.n) lista.push({ ix: ix, iz: iz, d: [0, 1] });
            }
        }
        return lista;
    }

    maxCarros() {
        // no maximo um carro para cada dois trechos de rua (evita engarrafamento total)
        return Math.min(20, Math.floor(this.trechos().length / 2));
    }
}

class Carro {
    constructor(id, cor) {
        this.id = id;
        this.cor = cor;
        this.pos = [0, 0];
        this.vel = [0, 0];
        this.direcao = [1, 0];
        this.dirSegmento = [1, 0];
        this.noAlvo = [0, 0];
        this.proxDir = [1, 0];
        this.alvo = [0, 0];
        this.tempoParado = 0;
        this.ignoraCarrosAte = 0;
        this.emColisao = false;
        this.reservas = new Set();
        this.oclusorChassi = null;
        this.oclusorCabine = null;
        this.obbCorpo = null;
        this.atualizaGeometria();
    }

    // Coloca o carro em um trecho: parte do no (ix, iz) na direcao d
    posiciona(cidade, rng, ix, iz, d, fracao) {
        let p0 = cidade.posicaoNo(ix, iz);
        let r = direitaDe(d);
        let ao = DISTANCIA_QUADRAS * fracao;
        this.pos = [p0[0] + d[0] * ao + r[0] * DESLOCAMENTO_FAIXA, p0[1] + d[1] * ao + r[1] * DESLOCAMENTO_FAIXA];
        this.direcao = [d[0], d[1]];
        this.dirSegmento = [d[0], d[1]];
        this.vel = [d[0] * CARRO_VEL_MAX * 0.5, d[1] * CARRO_VEL_MAX * 0.5];
        this.noAlvo = [ix + d[0], iz + d[1]];
        this.escolheConversao(cidade, rng);
        this.atualizaGeometria();
    }

    // Sorteia a direcao de saida no proximo cruzamento (sem voltar pelo mesmo caminho)
    escolheConversao(cidade, rng) {
        let d = this.dirSegmento;
        let opcoes = DIRECOES.filter(o =>
            !(o[0] === -d[0] && o[1] === -d[1]) && cidade.noValido(this.noAlvo[0] + o[0], this.noAlvo[1] + o[1]));
        this.proxDir = opcoes[Math.floor(rng() * opcoes.length)];
        this.alvo = cidade.pontoDeConversao(this.noAlvo[0], this.noAlvo[1], d, this.proxDir);
    }

    avancaNo(cidade, rng) {
        this.dirSegmento = this.proxDir;
        this.noAlvo = [this.noAlvo[0] + this.dirSegmento[0], this.noAlvo[1] + this.dirSegmento[1]];
        this.escolheConversao(cidade, rng);
    }

    eixos() {
        let f = [this.direcao[0], 0, this.direcao[1]];
        let r = [-this.direcao[1], 0, this.direcao[0]];
        return { frente: f, cima: [0, 1, 0], direita: r };
    }

    // Matrizes do chassi e da cabine, oclusores e OBB do corpo
    atualizaGeometria() {
        let e = this.eixos();
        let px = this.pos[0], pz = this.pos[1];
        this.matrizChassi = Matriz4.deEixos([px, 0.3, pz], e.frente, e.cima, e.direita, CARRO_MEIO_COMPR, 0.22, CARRO_MEIA_LARG);
        this.matrizCabine = Matriz4.deEixos([px - e.frente[0] * 0.12, 0.58, pz - e.frente[2] * 0.12],
            e.frente, e.cima, e.direita, 0.35, 0.18, 0.32);
        this.matrizesLentes = [-1, 1].map(lado => Matriz4.deEixos(
            [px + e.frente[0] * 0.74 + e.direita[0] * 0.3 * lado, 0.35, pz + e.frente[2] * 0.74 + e.direita[2] * 0.3 * lado],
            e.frente, e.cima, e.direita, 0.04, 0.06, 0.1));

        if (!this.oclusorChassi) {
            this.oclusorChassi = criaOclusor(this.matrizChassi, this.id);
            this.oclusorCabine = criaOclusor(this.matrizCabine, this.id);
        } else {
            atualizaOclusor(this.oclusorChassi, this.matrizChassi);
            atualizaOclusor(this.oclusorCabine, this.matrizCabine);
        }
        this.obbCorpo = new OBB([px, 0.42, pz], [e.frente, e.cima, e.direita], [CARRO_MEIO_COMPR, 0.34, CARRO_MEIA_LARG]);
    }

    // Duas luzes pontuais (requisito do artigo: luzes ideais pontuais)
    farois(modoFarol) {
        let cfg = CONFIG_FAROIS[modoFarol];
        let e = this.eixos();
        let dir = Vetor3.normaliza([e.frente[0], -cfg.inclinacao, e.frente[2]]);
        let luzes = [];
        for (let lado of [-1, 1]) {
            luzes.push({
                dono: this.id,
                pos: [
                    this.pos[0] + e.frente[0] * 0.8 + e.direita[0] * 0.3 * lado,
                    0.35,
                    this.pos[1] + e.frente[2] * 0.8 + e.direita[2] * 0.3 * lado
                ],
                dir: dir,
                cor: COR_FAROL,
                cosInterno: Math.cos(cfg.interno * Math.PI / 180),
                cosExterno: Math.cos(cfg.externo * Math.PI / 180),
                anguloExterno: cfg.externo * Math.PI / 180,
                atenuacao: cfg.atenuacao,
                potencia: cfg.potencia,
                alcance: cfg.alcance
            });
        }
        return luzes;
    }
}

class Simulacao {
    constructor(cidade, quantidade, semente) {
        this.cidade = cidade;
        this.rng = criaGeradorAleatorio(semente + 17);
        this.carros = [];
        this.tempo = 0;
        this.acumulador = 0;
        this.colisoes = 0;
        this.testesArvore = 0;     // testes OBB feitos contra os predios usando a OBBTree
        this.testesForcaBruta = 0; // testes que seriam feitos sem a OBBTree (um por predio)
        this.reservas = new Map();  // cruzamento "ix,iz" -> id do carro que o ocupa
        this.trechosLivres = cidade.trechos();
        // embaralha os trechos (Fisher-Yates com a semente)
        for (let i = this.trechosLivres.length - 1; i > 0; i--) {
            let j = Math.floor(this.rng() * (i + 1));
            let x = this.trechosLivres[i]; this.trechosLivres[i] = this.trechosLivres[j]; this.trechosLivres[j] = x;
        }
        for (let i = 0; i < quantidade; i++) this.adicionaCarro();
    }

    adicionaCarro() {
        if (this.carros.length >= this.cidade.maxCarros()) return false;
        let id = this.carros.length;
        let cor = [0.55 + this.rng() * 0.45, 0.55 + this.rng() * 0.45, 0.55 + this.rng() * 0.45];
        let carro = new Carro(id, cor);
        let t = this.trechosLivres[id % this.trechosLivres.length];
        // metade dos carros anda no sentido contrario do trecho
        if (this.rng() < 0.5) {
            carro.posiciona(this.cidade, this.rng, t.ix, t.iz, t.d, 0.5);
        } else {
            let d = [-t.d[0], -t.d[1]];
            carro.posiciona(this.cidade, this.rng, t.ix + t.d[0], t.iz + t.d[1], d, 0.5);
        }
        this.carros.push(carro);
        return true;
    }

    removeCarro() {
        if (this.carros.length <= 1) return false;
        let carro = this.carros.pop();
        for (let k of carro.reservas) this.reservas.delete(k);
        return true;
    }

    // "Nao bloquear o cruzamento": so entra se houver espaco na faixa de saida
    saidaLivre(c, pNo) {
        let d = c.proxDir, r = direitaDe(d);
        let px = pNo[0] + d[0] * 2.7 + r[0] * DESLOCAMENTO_FAIXA;
        let pz = pNo[1] + d[1] * 2.7 + r[1] * DESLOCAMENTO_FAIXA;
        for (let o of this.carros) {
            if (o === c) continue;
            let lento = Math.hypot(o.vel[0], o.vel[1]) < 0.4;
            let mesmoSentido = (o.direcao[0] * d[0] + o.direcao[1] * d[1]) > 0.5;
            if (lento && mesmoSentido && Math.hypot(o.pos[0] - px, o.pos[1] - pz) < 1.3) return false;
        }
        return true;
    }

    // Avanca a simulacao em passos fixos (resultado independe do FPS)
    avanca(dt) {
        this.acumulador += Math.min(dt, 0.25);
        let passos = 0;
        while (this.acumulador >= PASSO_SIMULACAO && passos < 16) {
            this.passo(PASSO_SIMULACAO);
            this.acumulador -= PASSO_SIMULACAO;
            passos++;
        }
    }

    passo(dt) {
        const cidade = this.cidade;
        const encontrados = [];

        for (let c of this.carros) {
            let paraAlvo = [c.alvo[0] - c.pos[0], c.alvo[1] - c.pos[1]];
            let dist = Math.hypot(paraAlvo[0], paraAlvo[1]);
            // Troca de alvo quando o carro alcanca o ponto de conversao (projecao no trecho)
            let restante = paraAlvo[0] * c.dirSegmento[0] + paraAlvo[1] * c.dirSegmento[1];
            if (restante <= 0.08) {
                c.avancaNo(cidade, this.rng);
                paraAlvo = [c.alvo[0] - c.pos[0], c.alvo[1] - c.pos[1]];
                dist = Math.hypot(paraAlvo[0], paraAlvo[1]);
            }

            // ARRIVE: reduz a velocidade antes de uma conversao
            let velDesejada = CARRO_VEL_MAX;
            let vaiConverter = c.proxDir[0] !== c.dirSegmento[0] || c.proxDir[1] !== c.dirSegmento[1];
            if (vaiConverter) velDesejada = CARRO_VEL_MAX * Math.max(0.35, Math.min(1, dist / 2.5));

            // RESERVA DE CRUZAMENTO: so um carro por vez dentro de cada cruzamento.
            // Sem a reserva o carro faz ARRIVE ate parar antes da faixa do cruzamento.
            let chaveNo = c.noAlvo[0] + ',' + c.noAlvo[1];
            let pNo = cidade.posicaoNo(c.noAlvo[0], c.noAlvo[1]);
            let distNo = (pNo[0] - c.pos[0]) * c.dirSegmento[0] + (pNo[1] - c.pos[1]) * c.dirSegmento[1];
            for (let k of c.reservas) {
                if (k === chaveNo) continue;
                let ij = k.split(',').map(Number);
                let p = cidade.posicaoNo(ij[0], ij[1]);
                if (Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1]) > 2.2) {
                    c.reservas.delete(k);
                    this.reservas.delete(k);
                }
            }
            if (distNo < 3.3 && !c.reservas.has(chaveNo)) {
                if (!this.reservas.has(chaveNo) && this.saidaLivre(c, pNo)) {
                    this.reservas.set(chaveNo, c.id);
                    c.reservas.add(chaveNo);
                } else {
                    velDesejada = Math.min(velDesejada, Math.max(0, (distNo - 2.5) * 2.5));
                }
            }

            // Sensor (OBB que cresce com a velocidade) orientado para a direcao desejada,
            // isto eh, para o alvo. Assim, durante uma conversao ele olha para a rua de
            // saida e nao para o predio do outro lado do cruzamento.
            let velocidade = Math.hypot(c.vel[0], c.vel[1]);
            let comprSensor = 0.6 + velocidade * 0.9;
            let fd = dist > 1e-6 ? [paraAlvo[0] / dist, paraAlvo[1] / dist] : c.direcao;
            let e = { frente: [fd[0], 0, fd[1]], cima: [0, 1, 0], direita: [-fd[1], 0, fd[0]] };
            let centroSensor = [
                c.pos[0] + e.frente[0] * (CARRO_MEIO_COMPR + comprSensor / 2), 0.42,
                c.pos[1] + e.frente[2] * (CARRO_MEIO_COMPR + comprSensor / 2)
            ];
            let sensor = new OBB(centroSensor, [e.frente, e.cima, e.direita], [comprSensor / 2, 0.3, 0.35]);

            // FRENAGEM: outro carro dentro do sensor
            if (this.tempo >= c.ignoraCarrosAte) {
                for (let o of this.carros) {
                    if (o === c) continue;
                    // carros na contramao andam na outra faixa: nao causam frenagem
                    let contramao = (c.direcao[0] * o.direcao[0] + c.direcao[1] * o.direcao[1]) < -0.7;
                    if (!contramao && testaOBB(sensor, o.obbCorpo)) { velDesejada = 0; break; }
                }
            }

            // DESVIO DE OBSTACULOS: consulta a OBBTree dos predios
            encontrados.length = 0;
            let antes = contadorTestesOBB;
            consultaOBBTree(cidade.arvore, sensor, encontrados);
            this.testesArvore += contadorTestesOBB - antes;
            this.testesForcaBruta += cidade.predios.length;
            let forcaLateral = [0, 0];
            for (let it of encontrados) {
                let afasta = [c.pos[0] - it.centro[0], c.pos[1] - it.centro[2]];
                let lado = Math.sign(afasta[0] * e.direita[0] + afasta[1] * e.direita[2]) || 1;
                forcaLateral[0] += e.direita[0] * lado * 3;
                forcaLateral[1] += e.direita[2] * lado * 3;
                velDesejada *= 0.5;
            }

            // PATH FOLLOWING + SEEK: busca um ponto sobre a faixa, 1.2 unidade a frente da
            // projecao do carro (sem passar do ponto de conversao). Isso corrige rapidamente
            // qualquer desvio lateral em relacao a faixa.
            let restanteFaixa = paraAlvo[0] * c.dirSegmento[0] + paraAlvo[1] * c.dirSegmento[1];
            let recuo = Math.max(0, restanteFaixa - 1.2);
            let pontoFaixa = [c.alvo[0] - c.dirSegmento[0] * recuo, c.alvo[1] - c.dirSegmento[1] * recuo];
            let paraFaixa = [pontoFaixa[0] - c.pos[0], pontoFaixa[1] - c.pos[1]];
            let distFaixa = Math.hypot(paraFaixa[0], paraFaixa[1]);
            let desejada = [0, 0];
            if (distFaixa > 1e-6) desejada = [paraFaixa[0] / distFaixa * velDesejada, paraFaixa[1] / distFaixa * velDesejada];
            // steering = (velocidade desejada - velocidade atual) / massa, truncado em FORCA_MAX
            let forca = [
                (desejada[0] - c.vel[0]) / CARRO_MASSA + forcaLateral[0],
                (desejada[1] - c.vel[1]) / CARRO_MASSA + forcaLateral[1]
            ];
            let mod = Math.hypot(forca[0], forca[1]);
            if (mod > CARRO_FORCA_MAX) forca = [forca[0] / mod * CARRO_FORCA_MAX, forca[1] / mod * CARRO_FORCA_MAX];

            c.vel[0] += forca[0] * dt;
            c.vel[1] += forca[1] * dt;
            velocidade = Math.hypot(c.vel[0], c.vel[1]);
            if (velocidade > CARRO_VEL_MAX) {
                c.vel = [c.vel[0] / velocidade * CARRO_VEL_MAX, c.vel[1] / velocidade * CARRO_VEL_MAX];
                velocidade = CARRO_VEL_MAX;
            }
            c.pos[0] += c.vel[0] * dt;
            c.pos[1] += c.vel[1] * dt;
            if (velocidade > 0.05) c.direcao = [c.vel[0] / velocidade, c.vel[1] / velocidade];

            // Evita travamento (ciclo de carros esperando uns pelos outros)
            if (velocidade < 0.05) {
                c.tempoParado += dt;
                if (c.tempoParado > 12.0) { c.ignoraCarrosAte = this.tempo + 1.0; c.tempoParado = 0; }
            } else {
                c.tempoParado = 0;
            }
            c.atualizaGeometria();
        }

        // DETECCAO DE COLISAO do corpo: OBBTree (predios) + pares de carros
        for (let c of this.carros) {
            encontrados.length = 0;
            let antes = contadorTestesOBB;
            consultaOBBTree(cidade.arvore, c.obbCorpo, encontrados);
            this.testesArvore += contadorTestesOBB - antes;
            this.testesForcaBruta += cidade.predios.length;
            let colide = encontrados.length > 0;
            for (let o of this.carros) {
                if (o !== c && testaOBB(c.obbCorpo, o.obbCorpo)) colide = true;
            }
            if (colide && !c.emColisao) this.colisoes++;
            c.emColisao = colide;
        }
        this.tempo += dt;
    }
}
