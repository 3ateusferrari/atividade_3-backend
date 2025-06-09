const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3004;

app.use(express.json());

const dbPath = path.join(__dirname, 'disparos.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS disparos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarme_id INTEGER NOT NULL,
        ponto_id INTEGER,
        ponto_nome TEXT,
        tipo_disparo TEXT NOT NULL,
        timestamp_disparo DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolvido BOOLEAN DEFAULT 0,
        timestamp_resolucao DATETIME,
        detalhes TEXT
    )`);
});

async function checkAlarmStatus(alarmeId) {
    try {
        const response = await axios.get(`http://localhost:3003/acionamento/status/${alarmeId}`);
        return response.data;
    } catch (error) {
        console.error('Erro ao verificar status do alarme:', error.message);
        return null;
    }
}

async function validateAlarm(alarmeId) {
    try {
        const response = await axios.get(`http://localhost:3002/alarmes/${alarmeId}`);
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

async function getAlarmUsers(alarmeId) {
    try {
        const response = await axios.get(`http://localhost:3002/alarmes/${alarmeId}/usuarios`);
        return response.data;
    } catch (error) {
        console.error('Erro ao buscar usuários do alarme:', error.message);
        return [];
    }
}

async function sendNotification(alarmeId, usuarioId, tipoEvento, detalhes) {
    try {
        await axios.post('http://localhost:3005/notificacao/enviar', {
            alarme_id: alarmeId,
            usuario_id: usuarioId,
            tipo: tipoEvento,
            mensagem: detalhes
        });
    } catch (error) {
        console.error('Erro ao enviar notificação:', error.message);
    }
}

async function logEvent(alarmeId, usuarioId, tipoEvento, detalhes) {
    try {
        await axios.post('http://localhost:3006/logs', {
            alarme_id: alarmeId,
            usuario_id: usuarioId,
            tipo_evento: tipoEvento,
            detalhes: detalhes
        });
    } catch (error) {
        console.error('Erro ao registrar log:', error.message);
    }
}

app.post('/disparo', async (req, res) => {
    const { 
        alarme_id, 
        ponto_id, 
        ponto_nome, 
        tipo_disparo = 'movimento', 
        detalhes 
    } = req.body;
    
    if (!alarme_id) {
        return res.status(400).json({ 
            error: 'ID do alarme é obrigatório' 
        });
    }

    const alarmExists = await validateAlarm(alarme_id);
    if (!alarmExists) {
        return res.status(404).json({ 
            error: 'Alarme não encontrado' 
        });
    }

    const alarmStatus = await checkAlarmStatus(alarme_id);
    if (!alarmStatus || alarmStatus.status !== 'ligado') {
        return res.status(409).json({ 
            error: 'Alarme não está ativo',
            status_atual: alarmStatus ? alarmStatus.status : 'desconhecido'
        });
    }

    const insertQuery = `INSERT INTO disparos 
                        (alarme_id, ponto_id, ponto_nome, tipo_disparo, detalhes) 
                        VALUES (?, ?, ?, ?, ?)`;
    
    db.run(insertQuery, [alarme_id, ponto_id, ponto_nome, tipo_disparo, detalhes], async function(err) {
        if (err) {
            console.error('Erro ao registrar disparo:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }

        const disparoId = this.lastID;
        const mensagemDisparo = `ALERTA: Disparo no alarme ${alarme_id} - ${ponto_nome || 'Ponto não identificado'} - Tipo: ${tipo_disparo}`;

        await logEvent(alarme_id, null, 'disparo', mensagemDisparo);

        const users = await getAlarmUsers(alarme_id);
        for (const user of users) {
            await sendNotification(alarme_id, user.usuario_id, 'disparo', mensagemDisparo);
        }

        res.status(201).json({
            id: disparoId,
            alarme_id: parseInt(alarme_id),
            ponto_id: ponto_id,
            ponto_nome,
            tipo_disparo,
            timestamp_disparo: new Date().toISOString(),
            resolvido: false,
            detalhes,
            message: 'Disparo registrado e notificações enviadas'
        });
    });
});

app.get('/disparo/:alarme_id', async (req, res) => {
    const { alarme_id } = req.params;
    const { resolvido, limit = 50 } = req.query;
    
    const alarmExists = await validateAlarm(alarme_id);
    if (!alarmExists) {
        return res.status(404).json({ 
            error: 'Alarme não encontrado' 
        });
    }

    let query = `SELECT * FROM disparos WHERE alarme_id = ?`;
    let queryParams = [alarme_id];

    if (resolvido !== undefined) {
        query += ` AND resolvido = ?`;
        queryParams.push(resolvido === 'true' ? 1 : 0);
    }

    query += ` ORDER BY timestamp_disparo DESC LIMIT ?`;
    queryParams.push(parseInt(limit));
    
    db.all(query, queryParams, (err, rows) => {
        if (err) {
            console.error('Erro ao buscar disparos:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        res.json(rows);
    });
});

app.get('/disparo/ativo/:alarme_id', async (req, res) => {
    const { alarme_id } = req.params;
    
    const alarmExists = await validateAlarm(alarme_id);
    if (!alarmExists) {
        return res.status(404).json({ 
            error: 'Alarme não encontrado' 
        });
    }

    const query = `SELECT * FROM disparos 
                   WHERE alarme_id = ? AND resolvido = 0 
                   ORDER BY timestamp_disparo DESC`;
    
    db.all(query, [alarme_id], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar disparos ativos:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        res.json({
            alarme_id: parseInt(alarme_id),
            disparos_ativos: rows.length,
            disparos: rows
        });
    });
});

app.patch('/disparo/:id/resolver', async (req, res) => {
    const { id } = req.params;
    
    const updateQuery = `UPDATE disparos 
                        SET resolvido = 1, timestamp_resolucao = CURRENT_TIMESTAMP 
                        WHERE id = ?`;
    
    db.run(updateQuery, [id], async function(err) {
        if (err) {
            console.error('Erro ao resolver disparo:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ 
                error: 'Disparo não encontrado' 
            });
        }

        const selectQuery = `SELECT * FROM disparos WHERE id = ?`;
        db.get(selectQuery, [id], async (err, row) => {
            if (!err && row) {
                await logEvent(row.alarme_id, null, 'disparo_resolvido', 
                    `Disparo ${id} foi marcado como resolvido`);
            }
        });
        
        res.json({
            id: parseInt(id),
            resolvido: true,
            timestamp_resolucao: new Date().toISOString(),
            message: 'Disparo marcado como resolvido'
        });
    });
});

app.get('/disparo', (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    
    const query = `SELECT * FROM disparos 
                   ORDER BY timestamp_disparo DESC 
                   LIMIT ? OFFSET ?`;
    
    db.all(query, [parseInt(limit), parseInt(offset)], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar todos os disparos:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        db.get('SELECT COUNT(*) as total FROM disparos', [], (err, countRow) => {
            if (err) {
                console.error('Erro ao contar disparos:', err);
                return res.status(500).json({ 
                    error: 'Erro interno do servidor' 
                });
            }
            
            res.json({
                disparos: rows,
                total: countRow.total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });
        });
    });
});

app.get('/disparo/stats/:alarme_id', async (req, res) => {
    const { alarme_id } = req.params;
    const { periodo = '30' } = req.query; // dias
    
    const alarmExists = await validateAlarm(alarme_id);
    if (!alarmExists) {
        return res.status(404).json({ 
            error: 'Alarme não encontrado' 
        });
    }

    const queries = {
        total: `SELECT COUNT(*) as count FROM disparos WHERE alarme_id = ?`,
        periodo: `SELECT COUNT(*) as count FROM disparos 
                 WHERE alarme_id = ? AND timestamp_disparo >= datetime('now', '-${periodo} days')`,
        resolvidos: `SELECT COUNT(*) as count FROM disparos WHERE alarme_id = ? AND resolvido = 1`,
        ativos: `SELECT COUNT(*) as count FROM disparos WHERE alarme_id = ? AND resolvido = 0`,
        tipos: `SELECT tipo_disparo, COUNT(*) as count FROM disparos 
               WHERE alarme_id = ? GROUP BY tipo_disparo`
    };

    const stats = {};
    
    try {
        const results = await Promise.all([
            new Promise((resolve, reject) => {
                db.get(queries.total, [alarme_id], (err, row) => {
                    if (err) reject(err);
                    else resolve({ total: row.count });
                });
            }),
            new Promise((resolve, reject) => {
                db.get(queries.periodo, [alarme_id], (err, row) => {
                    if (err) reject(err);
                    else resolve({ periodo: row.count });
                });
            }),
            new Promise((resolve, reject) => {
                db.get(queries.resolvidos, [alarme_id], (err, row) => {
                    if (err) reject(err);
                    else resolve({ resolvidos: row.count });
                });
            }),
            new Promise((resolve, reject) => {
                db.get(queries.ativos, [alarme_id], (err, row) => {
                    if (err) reject(err);
                    else resolve({ ativos: row.count });
                });
            }),
            new Promise((resolve, reject) => {
                db.all(queries.tipos, [alarme_id], (err, rows) => {
                    if (err) reject(err);
                    else resolve({ tipos: rows });
                });
            })
        ]);

        results.forEach(result => Object.assign(stats, result));

        res.json({
            alarme_id: parseInt(alarme_id),
            periodo_dias: parseInt(periodo),
            ...stats
        });

    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor' 
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'controle-disparo',
        timestamp: new Date().toISOString() 
    });
});

app.use((err, req, res, next) => {
    console.error('Erro no serviço de disparo:', err);
    res.status(500).json({ 
        error: 'Erro interno do servidor' 
    });
});

app.listen(PORT, () => {
    console.log(`Serviço de Controle de Disparo rodando na porta ${PORT}`);
});

process.on('SIGINT', () => {
    console.log('Fechando conexão com o banco de dados...');
    db.close((err) => {
        if (err) {
            console.error('Erro ao fechar banco:', err);
        } else {
            console.log('Conexão com banco fechada.');
        }
        process.exit(0);
    });
});
