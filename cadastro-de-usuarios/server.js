// cadastro-usuarios/server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3001;

app.use(express.json());

const dbPath = path.join(__dirname, 'usuarios.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        celular TEXT NOT NULL UNIQUE,
        email TEXT,
        data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.post('/usuarios', (req, res) => {
    const { nome, celular, email } = req.body;
    
    if (!nome || !celular) {
        return res.status(400).json({ 
            error: 'Nome e celular são obrigatórios' 
        });
    }

    const query = `INSERT INTO usuarios (nome, celular, email) VALUES (?, ?, ?)`;
    
    db.run(query, [nome, celular, email], function(err) {
        if (err) {
            if (err.code === 'SQLITE_CONSTRAINT') {
                return res.status(409).json({ 
                    error: 'Celular já cadastrado' 
                });
            }
            console.error('Erro ao criar usuário:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        res.status(201).json({
            id: this.lastID,
            nome,
            celular,
            email,
            message: 'Usuário criado com sucesso'
        });
    });
});

app.get('/usuarios', (req, res) => {
    const query = `SELECT * FROM usuarios ORDER BY data_cadastro DESC`;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar usuários:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        res.json(rows);
    });
});

app.get('/usuarios/:id', (req, res) => {
    const { id } = req.params;
    const query = `SELECT * FROM usuarios WHERE id = ?`;
    
    db.get(query, [id], (err, row) => {
        if (err) {
            console.error('Erro ao buscar usuário:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        if (!row) {
            return res.status(404).json({ 
                error: 'Usuário não encontrado' 
            });
        }
        
        res.json(row);
    });
});

app.put('/usuarios/:id', (req, res) => {
    const { id } = req.params;
    const { nome, celular, email } = req.body;
    
    if (!nome || !celular) {
        return res.status(400).json({ 
            error: 'Nome e celular são obrigatórios' 
        });
    }

    const query = `UPDATE usuarios SET nome = ?, celular = ?, email = ? WHERE id = ?`;
    
    db.run(query, [nome, celular, email, id], function(err) {
        if (err) {
            if (err.code === 'SQLITE_CONSTRAINT') {
                return res.status(409).json({ 
                    error: 'Celular já cadastrado para outro usuário' 
                });
            }
            console.error('Erro ao atualizar usuário:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ 
                error: 'Usuário não encontrado' 
            });
        }
        
        res.json({
            id: parseInt(id),
            nome,
            celular,
            email,
            message: 'Usuário atualizado com sucesso'
        });
    });
});

app.delete('/usuarios/:id', (req, res) => {
    const { id } = req.params;
    const query = `DELETE FROM usuarios WHERE id = ?`;
    
    db.run(query, [id], function(err) {
        if (err) {
            console.error('Erro ao deletar usuário:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ 
                error: 'Usuário não encontrado' 
            });
        }
        
        res.json({ 
            message: 'Usuário deletado com sucesso' 
        });
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'cadastro-usuarios',
        timestamp: new Date().toISOString() 
    });
});

app.use((err, req, res, next) => {
    console.error('Erro no serviço de usuários:', err);
    res.status(500).json({ 
        error: 'Erro interno do servidor' 
    });
});

app.listen(PORT, () => {
    console.log(`Serviço de Cadastro de Usuários rodando na porta ${PORT}`);
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
