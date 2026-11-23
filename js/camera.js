/*
  camera.js
  Tres modos de camera:
  - Orbita: arrastar com o botao esquerdo gira, botao direito (ou Shift) desloca,
            roda do mouse aproxima/afasta, WASD desloca o alvo.
  - Livre:  arrastar olha ao redor, WASD anda, Q/E desce/sobe, Shift acelera.
            Permite colocar a camera DENTRO de um volume de sombra (caso dificil do Z-Pass).
  - Seguir: acompanha o carro 1 por tras.
*/
'use strict';

class Camera {
    constructor(canvas) {
        this.modo = 'orbita';
        this.alvo = [0, 0, 0];
        this.yaw = 0;
        this.pitch = 0.93;
        this.distancia = 30;
        this.posLivre = [0, 2, 12];
        this.yawLivre = Math.PI;
        this.pitchLivre = -0.1;
        this.teclas = new Set();
        this._arrastando = null;
        this._ligaEventos(canvas);
    }

    padraoParaCidade(cidade) {
        this.alvo = [0, 0, 0];
        this.yaw = 0;
        this.pitch = 0.93;
        this.distancia = cidade.extensao * 2.0 + 12;
    }

    _ligaEventos(canvas) {
        canvas.addEventListener('contextmenu', ev => ev.preventDefault());
        canvas.addEventListener('mousedown', ev => {
            this._arrastando = { x: ev.clientX, y: ev.clientY, botao: ev.button, shift: ev.shiftKey };
            canvas.focus();
        });
        window.addEventListener('mouseup', () => { this._arrastando = null; });
        window.addEventListener('mousemove', ev => {
            if (!this._arrastando) return;
            let dx = ev.clientX - this._arrastando.x;
            let dy = ev.clientY - this._arrastando.y;
            this._arrastando.x = ev.clientX;
            this._arrastando.y = ev.clientY;
            let desloca = this._arrastando.botao === 2 || this._arrastando.shift;
            if (this.modo === 'orbita') {
                if (desloca) {
                    let k = this.distancia * 0.0015;
                    let f = this._frenteHorizontalOrbita();
                    let r = [-f[2], 0, f[0]];
                    this.alvo[0] += (-r[0] * dx + f[0] * dy) * k;
                    this.alvo[2] += (-r[2] * dx + f[2] * dy) * k;
                } else {
                    this.yaw -= dx * 0.008;
                    this.pitch = Math.max(0.05, Math.min(1.55, this.pitch + dy * 0.006));
                }
            } else if (this.modo === 'livre') {
                this.yawLivre -= dx * 0.005;
                this.pitchLivre = Math.max(-1.5, Math.min(1.5, this.pitchLivre - dy * 0.005));
            }
        });
        canvas.addEventListener('wheel', ev => {
            ev.preventDefault();
            if (this.modo === 'orbita') {
                this.distancia = Math.max(3, Math.min(150, this.distancia * Math.exp(ev.deltaY * 0.001)));
            } else if (this.modo === 'livre') {
                let f = this.frenteLivre();
                let passo = -ev.deltaY * 0.01;
                this.posLivre = Vetor3.soma(this.posLivre, Vetor3.escala(f, passo));
            }
        }, { passive: false });
        window.addEventListener('keydown', ev => {
            if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT')) return;
            this.teclas.add(ev.key.toLowerCase());
            if (ev.key === 'Shift') this.teclas.add('shift');
        });
        window.addEventListener('keyup', ev => {
            this.teclas.delete(ev.key.toLowerCase());
            if (ev.key === 'Shift') this.teclas.delete('shift');
        });
        window.addEventListener('blur', () => this.teclas.clear());
    }

    frenteLivre() {
        let cp = Math.cos(this.pitchLivre);
        return [cp * Math.sin(this.yawLivre), Math.sin(this.pitchLivre), cp * Math.cos(this.yawLivre)];
    }

    _frenteHorizontalOrbita() {
        return [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
    }

    olharPara(alvo) {
        let d = Vetor3.normaliza(Vetor3.subtrai(alvo, this.posLivre));
        this.yawLivre = Math.atan2(d[0], d[2]);
        this.pitchLivre = Math.asin(Math.max(-1, Math.min(1, d[1])));
    }

    // Atualiza movimento por teclado (dt em segundos)
    atualiza(dt) {
        let t = this.teclas;
        let vel = (t.has('shift') ? 18 : 6) * dt;
        if (this.modo === 'livre') {
            let f = this.frenteLivre();
            let r = Vetor3.normaliza([-f[2], 0, f[0]]);
            let mov = [0, 0, 0];
            if (t.has('w')) mov = Vetor3.soma(mov, f);
            if (t.has('s')) mov = Vetor3.subtrai(mov, f);
            if (t.has('d')) mov = Vetor3.soma(mov, r);
            if (t.has('a')) mov = Vetor3.subtrai(mov, r);
            if (t.has('e')) mov[1] += 1;
            if (t.has('q')) mov[1] -= 1;
            this.posLivre = Vetor3.soma(this.posLivre, Vetor3.escala(mov, vel));
        } else if (this.modo === 'orbita') {
            let f = this._frenteHorizontalOrbita();
            let r = [-f[2], 0, f[0]];
            let k = vel * this.distancia / 15;
            if (t.has('w')) { this.alvo[0] += f[0] * k; this.alvo[2] += f[2] * k; }
            if (t.has('s')) { this.alvo[0] -= f[0] * k; this.alvo[2] -= f[2] * k; }
            if (t.has('d')) { this.alvo[0] += r[0] * k; this.alvo[2] += r[2] * k; }
            if (t.has('a')) { this.alvo[0] -= r[0] * k; this.alvo[2] -= r[2] * k; }
        }
    }

    // Retorna { pos, matrizVisao }
    visao(carroSeguido) {
        let pos, alvo;
        if (this.modo === 'seguir' && carroSeguido) {
            let f = [carroSeguido.direcao[0], 0, carroSeguido.direcao[1]];
            pos = [carroSeguido.pos[0] - f[0] * 4.0, 2.2, carroSeguido.pos[1] - f[2] * 4.0];
            alvo = [carroSeguido.pos[0] + f[0] * 3.0, 0.4, carroSeguido.pos[1] + f[2] * 3.0];
        } else if (this.modo === 'livre') {
            pos = this.posLivre.slice();
            alvo = Vetor3.soma(pos, this.frenteLivre());
        } else {
            let cp = Math.cos(this.pitch);
            pos = [
                this.alvo[0] + this.distancia * cp * Math.sin(this.yaw),
                this.alvo[1] + this.distancia * Math.sin(this.pitch),
                this.alvo[2] + this.distancia * cp * Math.cos(this.yaw)
            ];
            alvo = this.alvo;
        }
        return { pos: pos, matrizVisao: Matriz4.cameraLookAt(pos, alvo, [0, 1, 0]) };
    }
}
