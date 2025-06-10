const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORTA = 3006;

app.use(cors());
app.use(express.json());

const caminhoBanco = path.join(__dirname, 'logs.db');
const banco = new sqlite3.Database(caminhoBanco);

banco.serialize(() => {
    banco.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarme_id INTEGER,
        usuario_id INTEGER,
        tipo_evento TEXT NOT NULL,
        detalhes TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.post('/logs', (req, res) => {
    const { alarme_id, usuario_id, tipo_evento, detalhes } = req.body;
    const consulta = `INSERT INTO logs (alarme_id, usuario_id, tipo_evento, detalhes) VALUES (?, ?, ?, ?)`;
    banco.run(consulta, [alarme_id, usuario_id, tipo_evento, detalhes], function(erro) {
        if (erro) {
            console.error('Erro ao registrar log:', erro);
            return res.status(500).json({ erro: 'Erro ao registrar log' });
        }
        res.status(201).json({ id: this.lastID, alarme_id, usuario_id, tipo_evento, detalhes });
    });
});

app.get('/logs', (req, res) => {
    banco.all('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100', [], (erro, linhas) => {
        if (erro) {
            return res.status(500).json({ erro: 'Erro ao buscar logs' });
        }
        res.json(linhas);
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', servico: 'logging', horario: new Date().toISOString() });
});

app.listen(PORTA, () => {
    console.log(`Serviço de Logging rodando na porta ${PORTA}`);
}); 