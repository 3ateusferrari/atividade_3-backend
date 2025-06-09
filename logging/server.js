const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3006;

app.use(cors());
app.use(express.json());

const dbPath = path.join(__dirname, 'logs.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS logs (
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
    const query = `INSERT INTO logs (alarme_id, usuario_id, tipo_evento, detalhes) VALUES (?, ?, ?, ?)`;
    db.run(query, [alarme_id, usuario_id, tipo_evento, detalhes], function(err) {
        if (err) {
            console.error('Erro ao registrar log:', err);
            return res.status(500).json({ error: 'Erro ao registrar log' });
        }
        res.status(201).json({ id: this.lastID, alarme_id, usuario_id, tipo_evento, detalhes });
    });
});

app.get('/logs', (req, res) => {
    db.all('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar logs' });
        }
        res.json(rows);
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'logging', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Serviço de Logging rodando na porta ${PORT}`);
}); 