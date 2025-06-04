const express = require('express');
const app = express();
app.use(express.json());

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('cadastro-de-alarmes.db');

db.run(`CREATE TABLE IF NOT EXISTS cadastro-de-alarmes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  evento TEXT,
  sensor_id INTEGER,  
)`);

app.post('/cadastro-de-alarmes', (req, res) => {
  const { timestamp, evento, sensor_id } = req.body;
  db.run('INSERT INTO logging (timestamp, evento, sensor_id ) VALUES (?, ?)', [timestamp, evento, sensor_id], function (err) {
    if (err) return res.status(500).send(err.message);
    res.status(201).json({ id: this.lastID, timestamp, evento, sensor_id});
  });
});

app.get('/cadastro-de-alarmes', (req, res) => {
  db.all('SELECT * FROM cadastro-de-alarmes', [], (err, rows) => {
    if (err) return res.status(500).send(err.message);
    res.json(rows);
  });
});

app.listen(3002, () => {
  console.log('Microserviço de cadastro de alarmes rodando na porta 3002'); 
});
