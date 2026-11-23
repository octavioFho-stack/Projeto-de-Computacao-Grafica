/*
  obbtree.js
  Deteccao de colisao com OBBs (Oriented Bounding Boxes) organizadas em uma
  hierarquia OBBTree (Gottschalk, Lin & Manocha, SIGGRAPH 1996):
  - ajuste da OBB pela matriz de covariancia dos pontos (autovetores = eixos);
  - divisao recursiva pelo eixo mais longo, no valor medio dos centros;
  - teste de sobreposicao entre duas OBBs pelo Teorema do Eixo Separador
    (15 eixos candidatos: 3 + 3 faces e 9 produtos vetoriais entre arestas).
*/
'use strict';

// Contador global de testes OBB-OBB (instrumentacao)
let contadorTestesOBB = 0;

class OBB {
    // c = centro, u = 3 eixos unitarios, e = meias-dimensoes ao longo de cada eixo
    constructor(c, u, e) {
        this.c = c;
        this.u = u;
        this.e = e;
    }

    // OBB exata de um cubo unitario transformado por uma matriz (rotacao + escala + translacao)
    static deMatriz(m) {
        let ex = [m[0], m[1], m[2]];
        let ey = [m[4], m[5], m[6]];
        let ez = [m[8], m[9], m[10]];
        return new OBB(
            [m[12], m[13], m[14]],
            [Vetor3.normaliza(ex), Vetor3.normaliza(ey), Vetor3.normaliza(ez)],
            [Vetor3.tamanho(ex), Vetor3.tamanho(ey), Vetor3.tamanho(ez)]
        );
    }

    contemPonto(p) {
        let d = Vetor3.subtrai(p, this.c);
        for (let i = 0; i < 3; i++) {
            if (Math.abs(Vetor3.produtoEscalar(d, this.u[i])) > this.e[i]) return false;
        }
        return true;
    }
}

// Teorema do Eixo Separador (formulacao de Gottschalk; ver tambem Ericson, RTCD 4.4.1)
function testaOBB(a, b) {
    contadorTestesOBB++;
    const EPS = 1e-6;
    const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const AR = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            R[i][j] = Vetor3.produtoEscalar(a.u[i], b.u[j]);
            AR[i][j] = Math.abs(R[i][j]) + EPS;
        }
    }
    let tw = Vetor3.subtrai(b.c, a.c);
    let t = [Vetor3.produtoEscalar(tw, a.u[0]), Vetor3.produtoEscalar(tw, a.u[1]), Vetor3.produtoEscalar(tw, a.u[2])];
    let ae = a.e, be = b.e, ra, rb;

    // Eixos de A
    for (let i = 0; i < 3; i++) {
        ra = ae[i];
        rb = be[0] * AR[i][0] + be[1] * AR[i][1] + be[2] * AR[i][2];
        if (Math.abs(t[i]) > ra + rb) return false;
    }
    // Eixos de B
    for (let j = 0; j < 3; j++) {
        ra = ae[0] * AR[0][j] + ae[1] * AR[1][j] + ae[2] * AR[2][j];
        rb = be[j];
        if (Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]) > ra + rb) return false;
    }
    // 9 produtos vetoriais A_i x B_j
    ra = ae[1] * AR[2][0] + ae[2] * AR[1][0]; rb = be[1] * AR[0][2] + be[2] * AR[0][1];
    if (Math.abs(t[2] * R[1][0] - t[1] * R[2][0]) > ra + rb) return false;
    ra = ae[1] * AR[2][1] + ae[2] * AR[1][1]; rb = be[0] * AR[0][2] + be[2] * AR[0][0];
    if (Math.abs(t[2] * R[1][1] - t[1] * R[2][1]) > ra + rb) return false;
    ra = ae[1] * AR[2][2] + ae[2] * AR[1][2]; rb = be[0] * AR[0][1] + be[1] * AR[0][0];
    if (Math.abs(t[2] * R[1][2] - t[1] * R[2][2]) > ra + rb) return false;
    ra = ae[0] * AR[2][0] + ae[2] * AR[0][0]; rb = be[1] * AR[1][2] + be[2] * AR[1][1];
    if (Math.abs(t[0] * R[2][0] - t[2] * R[0][0]) > ra + rb) return false;
    ra = ae[0] * AR[2][1] + ae[2] * AR[0][1]; rb = be[0] * AR[1][2] + be[2] * AR[1][0];
    if (Math.abs(t[0] * R[2][1] - t[2] * R[0][1]) > ra + rb) return false;
    ra = ae[0] * AR[2][2] + ae[2] * AR[0][2]; rb = be[0] * AR[1][1] + be[1] * AR[1][0];
    if (Math.abs(t[0] * R[2][2] - t[2] * R[0][2]) > ra + rb) return false;
    ra = ae[0] * AR[1][0] + ae[1] * AR[0][0]; rb = be[1] * AR[2][2] + be[2] * AR[2][1];
    if (Math.abs(t[1] * R[0][0] - t[0] * R[1][0]) > ra + rb) return false;
    ra = ae[0] * AR[1][1] + ae[1] * AR[0][1]; rb = be[0] * AR[2][2] + be[2] * AR[2][0];
    if (Math.abs(t[1] * R[0][1] - t[0] * R[1][1]) > ra + rb) return false;
    ra = ae[0] * AR[1][2] + ae[1] * AR[0][2]; rb = be[0] * AR[2][1] + be[1] * AR[2][0];
    if (Math.abs(t[1] * R[0][2] - t[0] * R[1][2]) > ra + rb) return false;

    return true; // nenhum eixo separa: as caixas se sobrepoem
}

// Autovetores de matriz simetrica 3x3 pelo metodo de Jacobi
function autovetoresSimetrica3(A) {
    let a = [A[0].slice(), A[1].slice(), A[2].slice()];
    let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let iter = 0; iter < 50; iter++) {
        let p = 0, q = 1, maior = Math.abs(a[0][1]);
        if (Math.abs(a[0][2]) > maior) { p = 0; q = 2; maior = Math.abs(a[0][2]); }
        if (Math.abs(a[1][2]) > maior) { p = 1; q = 2; maior = Math.abs(a[1][2]); }
        if (maior < 1e-10) break;
        let theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        let t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        let c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
            let akp = a[k][p], akq = a[k][q];
            a[k][p] = c * akp - s * akq;
            a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
            let apk = a[p][k], aqk = a[q][k];
            a[p][k] = c * apk - s * aqk;
            a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
            let vkp = v[k][p], vkq = v[k][q];
            v[k][p] = c * vkp - s * vkq;
            v[k][q] = s * vkp + c * vkq;
        }
    }
    // colunas de v sao os autovetores
    return [
        Vetor3.normaliza([v[0][0], v[1][0], v[2][0]]),
        Vetor3.normaliza([v[0][1], v[1][1], v[2][1]]),
        Vetor3.normaliza([v[0][2], v[1][2], v[2][2]])
    ];
}

// Ajusta uma OBB a um conjunto de pontos usando a matriz de covariancia
function ajustaOBB(pontos) {
    let n = pontos.length;
    let media = [0, 0, 0];
    for (let p of pontos) { media[0] += p[0]; media[1] += p[1]; media[2] += p[2]; }
    media = Vetor3.escala(media, 1 / n);

    let C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let p of pontos) {
        let d = Vetor3.subtrai(p, media);
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j] / n;
        }
    }
    let u = autovetoresSimetrica3(C);

    // Projeta os pontos nos eixos para achar o centro e as meias-dimensoes
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let p of pontos) {
        for (let i = 0; i < 3; i++) {
            let s = Vetor3.produtoEscalar(p, u[i]);
            if (s < min[i]) min[i] = s;
            if (s > max[i]) max[i] = s;
        }
    }
    let c = [0, 0, 0], e = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
        let meio = (min[i] + max[i]) / 2;
        e[i] = Math.max((max[i] - min[i]) / 2, 1e-4);
        c = Vetor3.soma(c, Vetor3.escala(u[i], meio));
    }
    return new OBB(c, u, e);
}

// Constroi a OBBTree de cima para baixo. Cada item: { obb, pontos, centro, ... }
function constroiOBBTree(itens, profundidade) {
    profundidade = profundidade || 0;
    if (itens.length === 1) {
        return { obb: itens[0].obb, item: itens[0], profundidade: profundidade };
    }
    let pontos = [];
    for (let it of itens) pontos.push(...it.pontos);
    let obb = ajustaOBB(pontos);

    // Divide pelo eixo mais longo da OBB, no valor medio dos centros projetados
    let k = 0;
    if (obb.e[1] > obb.e[k]) k = 1;
    if (obb.e[2] > obb.e[k]) k = 2;
    let proj = itens.map(it => Vetor3.produtoEscalar(Vetor3.subtrai(it.centro, obb.c), obb.u[k]));
    let media = proj.reduce((s, x) => s + x, 0) / proj.length;
    let esq = [], dir = [];
    itens.forEach((it, i) => (proj[i] < media ? esq : dir).push(it));
    if (esq.length === 0 || dir.length === 0) {
        // Centros alinhados: divide pela mediana
        let ordem = itens.map((it, i) => [proj[i], it]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
        let meio = Math.floor(ordem.length / 2);
        esq = ordem.slice(0, meio);
        dir = ordem.slice(meio);
    }
    return {
        obb: obb,
        esq: constroiOBBTree(esq, profundidade + 1),
        dir: constroiOBBTree(dir, profundidade + 1),
        profundidade: profundidade
    };
}

// Percorre a arvore: so desce nos ramos cuja OBB intersecta a consulta
function consultaOBBTree(no, obbConsulta, saida) {
    if (!testaOBB(no.obb, obbConsulta)) return;
    if (no.item) {
        saida.push(no.item);
        return;
    }
    consultaOBBTree(no.esq, obbConsulta, saida);
    consultaOBBTree(no.dir, obbConsulta, saida);
}

// Intervalo [tmin, tmax] em que a reta p + t*d esta dentro da OBB (ou null)
function intervaloRetaOBB(p, d, obb) {
    let tmin = -Infinity, tmax = Infinity;
    let delta = Vetor3.subtrai(p, obb.c);
    for (let i = 0; i < 3; i++) {
        let o = Vetor3.produtoEscalar(delta, obb.u[i]);
        let dd = Vetor3.produtoEscalar(d, obb.u[i]);
        if (Math.abs(dd) < 1e-12) {
            if (Math.abs(o) > obb.e[i]) return null;
        } else {
            let t1 = (-obb.e[i] - o) / dd;
            let t2 = (obb.e[i] - o) / dd;
            if (t1 > t2) { let x = t1; t1 = t2; t2 = x; }
            if (t1 > tmin) tmin = t1;
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) return null;
        }
    }
    return [tmin, tmax];
}

// O segmento p0 -> p1 atravessa a OBB?
function segmentoIntersectaOBB(p0, p1, obb) {
    let r = intervaloRetaOBB(p0, Vetor3.subtrai(p1, p0), obb);
    return r !== null && r[1] >= 0 && r[0] <= 1;
}
