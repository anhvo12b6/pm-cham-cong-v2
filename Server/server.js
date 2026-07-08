const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sql = require('mssql');
const { connectDBs, authPool, mitacoPool } = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- MIDDLEWARE KIỂM TRA PHÂN QUYỀN ---
const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) return res.status(401).json({ message: "Chưa đăng nhập!" });

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) return res.status(403).json({ message: "Token hết hạn!" });
            
            const hasRole = decoded.roles.some(r => allowedRoles.includes(r));
            if (!hasRole) return res.status(403).json({ message: "Không có quyền truy cập!" });
            
            req.user = decoded;
            next();
        });
    };
};

// --- ROUTE API 1: ĐĂNG NHẬP ---
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    console.log("Dữ liệu nhận được từ Frontend:", username, password);
    try {
        const userRes = await authPool.request()
            .input('user', sql.NVarChar, username)
            .query('SELECT * FROM Web_Users WHERE Username = @user AND IsActive = 1');
        
        const user = userRes.recordset[0];
        if (!user || !(await bcrypt.compare(password, user.PasswordHash))) {
            console.log("Đăng nhập thất bại: Tài khoản hoặc mật khẩu không khớp!");
            return res.status(400).json({ message: "Sai tài khoản hoặc mật khẩu" });
        }

        const rolesRes = await authPool.request()
            .input('userId', sql.Int, user.UserID)
            .query('SELECT r.RoleName FROM Web_UserRoles ur JOIN Web_Roles r ON ur.RoleID = r.RoleID WHERE ur.UserID = @userId');
        
        const roles = rolesRes.recordset.map(r => r.RoleName);
        const token = jwt.sign({ userId: user.UserID, username: user.Username, roles, maChamCong: user.MaChamCong }, process.env.JWT_SECRET, { expiresIn: '8h' });

        res.json({ token, roles, fullName: user.FullName });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROUTE API 2: LẤY DANH SÁCH PHÒNG BAN (Cho Dropdown) ---
app.get('/api/phong-ban', checkRole(['Admin', 'Manager']), async (req, res) => {
    try {
        const result = await mitacoPool.request().query('SELECT MaPhongBan, TenPhongBan FROM [dbo].[PHONGBAN]');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ROUTE API 3: LẤY BÁO CÁO CÔNG THEO PHÒNG BAN & KHOẢNG NGÀY ---
app.get('/api/bao-cao/phong-ban', checkRole(['Admin', 'Manager']), async (req, res) => {
    const { maPhongBan, tuNgay, denNgay } = req.query;
    try {
        const result = await mitacoPool.request()
            .input('MaPhongBan', sql.VarChar, maPhongBan)
            .input('TuNgay', sql.Date, tuNgay)
            .input('DenNgay', sql.Date, denNgay)
            .query(`
                SELECT tc.MaChamCong, nv.UserFullName AS TenNhanVien, tc.Ngay, tc.Thu, 
                       tc.GioVao, tc.GioRa, tc.Cong, tc.TongGio, tc.KyHieu
                FROM [dbo].[TinhCong] tc
                INNER JOIN [dbo].[UserEnroll] nv ON tc.MaChamCong = nv.EnrollNumber
                WHERE tc.MaPhongBan = @MaPhongBan AND tc.Ngay BETWEEN @TuNgay AND @DenNgay
                ORDER BY tc.Ngay ASC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

connectDBs().then(() => {
    app.listen(3000, () => console.log("Backend running on port 3000"));
});