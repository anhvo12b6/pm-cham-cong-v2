const sql = require('mssql');
require('dotenv').config();

// ĐẢM BẢO DÒNG NÀY PHẢI NẰM ĐẦU TIÊN TRONG FILE db.js
require('dotenv').config(); 


const authConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT) || 54330, // Thêm "|| 54330" để phòng hờ nếu .env lỗi nó vẫn ăn port này
    database: 'WebApp_Auth',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

const mitacoConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT) || 54330, // Thêm ở đây luôn
    database: 'MITACOSQL',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

// ... giữ nguyên phần pool và export bên dưới

const authPool = new sql.ConnectionPool(authConfig);
const mitacoPool = new sql.ConnectionPool(mitacoConfig);

const connectDBs = async () => {
    await authPool.connect();
    await mitacoPool.connect();
    console.log("Connected to both DBs successfully!");
};

module.exports = { connectDBs, authPool, mitacoPool };