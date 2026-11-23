/*
  FHO - Fundação Hermínio Ometto
  Disciplina: Computação Gráfica - Prof. Renato Cagnin
  Alunos: Octavio Gomes Chinalle (RA 109524) e Guilherme de Oliveira Rodrigues (RA 105926)
  Projeto Eixo 7: Volumes de sombra com Z-Fail (Everitt & Kilgard, 2002)

  matematica.js
  Vetores 3D, matrizes 4x4 (column-major, mesmo padrao do OpenGL/WebGL)
  e um gerador aleatorio com semente (para os testes serem reproduziveis).
*/
'use strict';

class Vetor3 {
    static soma(a, b) {
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    }

    static subtrai(a, b) {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }

    static escala(a, s) {
        return [a[0] * s, a[1] * s, a[2] * s];
    }

    static produtoVetorial(a, b) {
        let x = a[1] * b[2] - a[2] * b[1];
        let y = a[2] * b[0] - a[0] * b[2];
        let z = a[0] * b[1] - a[1] * b[0];
        return [x, y, z];
    }

    static produtoEscalar(a, b) {
        return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
    }

    static tamanho(a) {
        return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    }

    static normaliza(a) {
        let tamanho = Vetor3.tamanho(a);
        if (tamanho > 0) {
            return [a[0] / tamanho, a[1] / tamanho, a[2] / tamanho];
        }
        return [0, 0, 0];
    }
}

class Matriz4 {
    static identidade() {
        return new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);
    }

    static multiplica(a, b) {
        let matriz = new Float32Array(16);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                matriz[j * 4 + i] = a[i] * b[j * 4] + a[i + 4] * b[j * 4 + 1] + a[i + 8] * b[j * 4 + 2] + a[i + 12] * b[j * 4 + 3];
            }
        }
        return matriz;
    }

    static translacaoEscala(tx, ty, tz, sx, sy, sz) {
        let matriz = Matriz4.identidade();
        matriz[0] = sx;
        matriz[5] = sy;
        matriz[10] = sz;
        matriz[12] = tx;
        matriz[13] = ty;
        matriz[14] = tz;
        return matriz;
    }

    // Monta a matriz a partir de uma base ortonormal (usado nos carros, que giram em Y).
    // Cada coluna eh um eixo do objeto ja multiplicado pela sua escala.
    static deEixos(origem, eixoX, eixoY, eixoZ, sx, sy, sz) {
        let m = new Float32Array(16);
        m[0] = eixoX[0] * sx; m[1] = eixoX[1] * sx; m[2] = eixoX[2] * sx;
        m[4] = eixoY[0] * sy; m[5] = eixoY[1] * sy; m[6] = eixoY[2] * sy;
        m[8] = eixoZ[0] * sz; m[9] = eixoZ[1] * sz; m[10] = eixoZ[2] * sz;
        m[12] = origem[0]; m[13] = origem[1]; m[14] = origem[2]; m[15] = 1;
        return m;
    }

    static cameraLookAt(posicaoCamera, alvo, cima) {
        let z = Vetor3.normaliza(Vetor3.subtrai(posicaoCamera, alvo));
        let x = Vetor3.normaliza(Vetor3.produtoVetorial(cima, z));
        let y = Vetor3.normaliza(Vetor3.produtoVetorial(z, x));

        let matriz = Matriz4.identidade();
        matriz[0] = x[0]; matriz[4] = x[1]; matriz[8] = x[2];
        matriz[1] = y[0]; matriz[5] = y[1]; matriz[9] = y[2];
        matriz[2] = z[0]; matriz[6] = z[1]; matriz[10] = z[2];
        matriz[12] = -Vetor3.produtoEscalar(x, posicaoCamera);
        matriz[13] = -Vetor3.produtoEscalar(y, posicaoCamera);
        matriz[14] = -Vetor3.produtoEscalar(z, posicaoCamera);
        return matriz;
    }

    // Matriz Pinf do artigo (secao 3.2.1): limite da projecao perspectiva com Far -> infinito.
    // Somente a terceira linha muda: [0 0 -1 -2*near]. Vertices com w = 0 ficam
    // exatamente em profundidade 1.0 e nunca sao recortados pelo plano distante.
    static perspectivaInfinita(fov, aspecto, near) {
        let f = 1.0 / Math.tan(fov / 2);
        let matriz = new Float32Array(16);
        matriz[0] = f / aspecto;
        matriz[5] = f;
        matriz[10] = -1.0;
        matriz[11] = -1.0;
        matriz[14] = -2.0 * near;
        matriz[15] = 0.0;
        return matriz;
    }

    static transformaPonto(m, v) {
        let x = (m[0] * v[0]) + (m[4] * v[1]) + (m[8] * v[2]) + m[12];
        let y = (m[1] * v[0]) + (m[5] * v[1]) + (m[9] * v[2]) + m[13];
        let z = (m[2] * v[0]) + (m[6] * v[1]) + (m[10] * v[2]) + m[14];
        return [x, y, z];
    }
}

// Gerador pseudoaleatorio com semente (mulberry32). Com a mesma semente a cidade,
// as cores e as decisoes dos carros se repetem, deixando o benchmark reproduzivel.
function criaGeradorAleatorio(semente) {
    let s = semente >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
