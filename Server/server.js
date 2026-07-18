const express = require("express");
const sql = require("mssql");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cors = require("cors");
const ExcelJS = require("exceljs");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// -------------------------------------------------------------------------
// 1. CẤU HÌNH KẾT NỐI DATABASE
// -------------------------------------------------------------------------

// Cấu hình Database phân quyền ứng dụng (WebApp_Auth)
const authConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: "WebApp_Auth",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

// Cấu hình Database chấm công gốc (MITACOSQL)
const mitacoConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: "MITACOSQL",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: { max: 15, min: 0, idleTimeoutMillis: 30000 },
};

// Khởi tạo các kết nối Pool và bắt lỗi trực quan
const authPool = new sql.ConnectionPool(authConfig);
const mitacoPool = new sql.ConnectionPool(mitacoConfig);

authPool
  .connect()
  .then(() =>
    console.log("✅ Đã kết nối thành công Database WebApp_Auth (Phân quyền)"),
  )
  .catch((err) =>
    console.error("❌ LỖI KẾT NỐI DATABASE WebApp_Auth:", err.message),
  );

mitacoPool
  .connect()
  .then(() =>
    console.log("✅ Đã kết nối thành công Database MITACOSQL (Chấm công)"),
  )
  .catch((err) =>
    console.error("❌ LỖI KẾT NỐI DATABASE MITACOSQL:", err.message),
  );

// Middleware xác thực Token (Hỗ trợ cả Authorization Header và Cookie)
const authenticate = (req, res, next) => {
  let token = req.headers["authorization"];
  if (!token) {
    // Lấy token từ cookie
    const cookieHeader = req.headers.cookie ? req.headers.cookie : "";
    if (cookieHeader.includes("token=")) {
      const match = cookieHeader.match(/token=([^;]+)/);
      if (match) {
        token = match[1];
      } else {
        return res.status(401).json({ message: "Bạn chưa đăng nhập!" });
      }
    } else {
      return res.status(401).json({ message: "Bạn chưa đăng nhập!" });
    }
  }

  if (token.startsWith("Bearer ")) {
    token = token.replace("Bearer ", "");
  }

  try {
    // Thử giải mã bằng JWT_SECRET trước (của App), nếu không được thì thử giải mã bằng JWT_KEY (của SSO/IT Workspace)
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      decoded = jwt.verify(token, process.env.JWT_KEY || "CHẤM CÔNG APP V2");
    }

    req.user = decoded;
    res.locals.user = decoded; // Tương thích ngược với định dạng của IT
    next();
  } catch (error) {
    return res.status(401).json({ message: "Bạn chưa đăng nhập!" });
  }
};

// Middleware kiểm tra quyền truy cập Token JWT (Chạy sau authenticate)
const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Bạn chưa đăng nhập!" });
    }
    const hasRole =
      req.user.roles &&
      req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      return res
        .status(403)
        .json({ message: "Tài khoản không có quyền truy cập chức năng này" });
    }
    next();
  };
};

// -------------------------------------------------------------------------
// 2. CÁC ROUTE API HỆ THỐNG
// -------------------------------------------------------------------------

// [API 1]: Đăng nhập hệ thống (Xác thực từ DB WebApp_Auth)
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const pool = await authPool;
    const result = await pool
      .request()
      .input("Username", sql.NVarChar(50), username).query(`
                SELECT u.UserID, u.Username, u.PasswordHash, u.FullName, u.MaChamCong, u.IsActive, u.AllowedKhuVuc, u.AllowedPhongBan
                FROM Web_Users u
                WHERE u.Username = @Username AND u.IsActive = 1
            `);

    const user = result.recordset[0];

    if (!user || !(await bcrypt.compare(password, user.PasswordHash))) {
      return res
        .status(400)
        .json({ message: "Tài khoản hoặc mật khẩu không khớp!" });
    }

    // Lấy danh sách các vai trò (roles) của người dùng
    const rolesResult = await pool
      .request()
      .input("UserID", sql.Int, user.UserID).query(`
                SELECT r.RoleName 
                FROM Web_UserRoles ur
                INNER JOIN Web_Roles r ON ur.RoleID = r.RoleID
                WHERE ur.UserID = @UserID
            `);

    const roles = rolesResult.recordset.map((row) => row.RoleName);

    // Khởi tạo Token mã hóa JWT
    const token = jwt.sign(
      {
        userId: user.UserID,
        username: user.Username,
        roles: roles,
        maChamCong: user.MaChamCong,
        allowedKhuVuc: user.AllowedKhuVuc,
        allowedPhongBan: user.AllowedPhongBan,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    res.json({
      token,
      roles,
      fullName: user.FullName,
      allowedKhuVuc: user.AllowedKhuVuc,
      allowedPhongBan: user.AllowedPhongBan,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [API 1.5]: Đăng nhập thông qua SSO (Single Sign-On từ Workspace)
const handleSSOLogin = async (req, res) => {
  const token = req.params.token;

  if (!token) {
    return res.status(400).send("Token is required for login");
  }

  try {
    // Giải mã SSO Token bằng khóa ký cố định mà IT gửi (đọc từ JWT_KEY trong .env hoặc mặc định tên App)
    const decodedSSO = jwt.verify(
      token,
      process.env.JWT_KEY || "CHẤM CÔNG APP V2",
    );
    const username = decodedSSO.username;

    if (!username) {
      return res
        .status(400)
        .send("SSO Token invalid: username field is missing");
    }

    const pool = await authPool;
    const result = await pool
      .request()
      .input("Username", sql.NVarChar(50), username).query(`
                SELECT u.UserID, u.Username, u.FullName, u.MaChamCong, u.IsActive, u.AllowedKhuVuc, u.AllowedPhongBan
                FROM Web_Users u
                WHERE u.Username = @Username AND u.IsActive = 1
            `);

    const user = result.recordset[0];

    if (!user) {
      const clientHost = req.hostname;
      const clientUrl = process.env.CLIENT_URL || `http://${clientHost}:5175`;
      return res.redirect(
        `${clientUrl}?sso_error=${encodeURIComponent(`Không tìm thấy tài khoản '${username}' trong hệ thống!`)}`,
      );
    }

    // Lấy danh sách các vai trò (roles) của người dùng
    const rolesResult = await pool
      .request()
      .input("UserID", sql.Int, user.UserID).query(`
                SELECT r.RoleName 
                FROM Web_UserRoles ur
                INNER JOIN Web_Roles r ON ur.RoleID = r.RoleID
                WHERE ur.UserID = @UserID
            `);

    const roles = rolesResult.recordset.map((row) => row.RoleName);

    // Tạo ứng dụng Token JWT riêng của chúng ta
    const appToken = jwt.sign(
      {
        userId: user.UserID,
        username: user.Username,
        roles: roles,
        maChamCong: user.MaChamCong,
        allowedKhuVuc: user.AllowedKhuVuc,
        allowedPhongBan: user.AllowedPhongBan,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" },
    );

    // Xác định client URL để redirect về (Ưu tiên process.env.CLIENT_URL, nếu không có sẽ lấy hostname hiện tại)
    const clientHost = req.hostname;
    const clientUrl = process.env.CLIENT_URL || `http://${clientHost}:5175`;

    // Redirect kèm các tham số đăng nhập để Frontend tự động lưu
    const redirectUrl = `${clientUrl}?token=${appToken}&roles=${encodeURIComponent(JSON.stringify(roles))}&fullName=${encodeURIComponent(user.FullName)}&allowedKhuVuc=${encodeURIComponent(user.AllowedKhuVuc || "[]")}&allowedPhongBan=${encodeURIComponent(user.AllowedPhongBan || "[]")}`;

    res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("SSO Login Error:", err.message);
    const clientHost = req.hostname;
    const clientUrl = process.env.CLIENT_URL || `http://${clientHost}:5175`;
    res.redirect(`${clientUrl}?sso_error=${encodeURIComponent(err.message)}`);
  }
};

app.get("/api/auth/sso/:token", handleSSOLogin);
app.get("/api/auth/sso-login/:token", handleSSOLogin);

// [API 2]: Lấy danh mục phòng ban (Dữ liệu từ MITACOSQL)
app.get("/api/phong-ban", authenticate, async (req, res) => {
  try {
    const decodedUser = req.user;
    const pool = await mitacoPool;

    const isAdmin = decodedUser.roles.includes("Admin");
    const isManager = decodedUser.roles.includes("Manager");

    if (isAdmin) {
      // Admin: Lấy toàn bộ phòng ban kèm tên Khu Vực
      const result = await pool.request().query(`
                SELECT pb.MaPhongBan, pb.TenPhongBan, pb.MaKhuVuc, kv.TenKhuVuc
                FROM [dbo].[PHONGBAN] pb
                LEFT JOIN [dbo].[KHUVUC] kv ON pb.MaKhuVuc = kv.MaKhuVuc
                WHERE pb.MaPhongBan IS NOT NULL
            `);
      const trimmed = result.recordset.map((row) => ({
        MaPhongBan: row.MaPhongBan ? row.MaPhongBan.trim() : null,
        TenPhongBan: row.TenPhongBan ? row.TenPhongBan.trim() : null,
        MaKhuVuc: row.MaKhuVuc ? row.MaKhuVuc.trim() : null,
        TenKhuVuc: row.TenKhuVuc ? row.TenKhuVuc.trim() : null,
      }));
      return res.json(trimmed);
    } else if (isManager) {
      // Manager: Lọc theo AllowedKhuVuc và AllowedPhongBan
      let allowedKhuVuc = [];
      let allowedPhongBan = [];
      try {
        if (decodedUser.allowedKhuVuc) {
          allowedKhuVuc = JSON.parse(decodedUser.allowedKhuVuc);
        }
      } catch (e) {
        console.error("Lỗi parse allowedKhuVuc:", e);
      }
      try {
        if (decodedUser.allowedPhongBan) {
          allowedPhongBan = JSON.parse(decodedUser.allowedPhongBan);
        }
      } catch (e) {
        console.error("Lỗi parse allowedPhongBan:", e);
      }

      if (allowedKhuVuc.length === 0 && allowedPhongBan.length === 0) {
        return res.json([]);
      }

      const request = pool.request();
      const kvParams = allowedKhuVuc.map((kv, i) => {
        request.input(`kv${i}`, sql.VarChar(50), kv.trim());
        return `@kv${i}`;
      });
      const pbParams = allowedPhongBan.map((pb, i) => {
        request.input(`pb${i}`, sql.VarChar(50), pb.trim());
        return `@pb${i}`;
      });

      let whereClauses = [];
      if (kvParams.length > 0) {
        whereClauses.push(`pb.MaKhuVuc IN (${kvParams.join(", ")})`);
      }
      if (pbParams.length > 0) {
        whereClauses.push(`pb.MaPhongBan IN (${pbParams.join(", ")})`);
      }

      const query = `
                SELECT pb.MaPhongBan, pb.TenPhongBan, pb.MaKhuVuc, kv.TenKhuVuc
                FROM [dbo].[PHONGBAN] pb
                LEFT JOIN [dbo].[KHUVUC] kv ON pb.MaKhuVuc = kv.MaKhuVuc
                WHERE pb.MaPhongBan IS NOT NULL
                  AND (${whereClauses.join(" OR ")})
            `;

      const result = await request.query(query);
      const trimmed = result.recordset.map((row) => ({
        MaPhongBan: row.MaPhongBan ? row.MaPhongBan.trim() : null,
        TenPhongBan: row.TenPhongBan ? row.TenPhongBan.trim() : null,
        MaKhuVuc: row.MaKhuVuc ? row.MaKhuVuc.trim() : null,
        TenKhuVuc: row.TenKhuVuc ? row.TenKhuVuc.trim() : null,
      }));
      return res.json(trimmed);
    } else {
      return res
        .status(403)
        .json({ message: "Bạn không có quyền truy cập chức năng này!" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [API 3]: Tải dữ liệu báo cáo chấm công (Tính toán động trực tiếp từ CheckInOut)
app.get("/api/bao-cao/phong-ban", authenticate, async (req, res) => {
  let { maPhongBan, xiNghiep, tuNgay, denNgay, maChamCong } = req.query;

  if (!tuNgay || !denNgay) {
    return res.status(400).json({ message: "Thiếu tham số ngày tháng!" });
  }

  const searchCode = maChamCong ? String(maChamCong).trim() : "";

  try {
    const decodedUser = req.user;
    const pool = await mitacoPool;

    const isAdmin = decodedUser.roles.includes("Admin");
    const isManager = decodedUser.roles.includes("Manager");

    if (!isAdmin && !isManager) {
      return res
        .status(403)
        .json({ message: "Bạn không có quyền xem báo cáo!" });
    }

    // Lọc theo phân quyền nếu là Manager và không phải Admin
    let allowedKhuVuc = [];
    let allowedPhongBan = [];
    if (isManager && !isAdmin) {
      try {
        if (decodedUser.allowedKhuVuc) {
          allowedKhuVuc = JSON.parse(decodedUser.allowedKhuVuc);
        }
      } catch (e) {
        console.error("Lỗi parse allowedKhuVuc:", e);
      }
      try {
        if (decodedUser.allowedPhongBan) {
          allowedPhongBan = JSON.parse(decodedUser.allowedPhongBan);
        }
      } catch (e) {
        console.error("Lỗi parse allowedPhongBan:", e);
      }

      if (allowedKhuVuc.length === 0 && allowedPhongBan.length === 0) {
        return res.status(403).json({
          message:
            "Tài khoản của bạn chưa được phân quyền xem bất kỳ bộ phận nào!",
        });
      }

      if (maPhongBan === "ALL") {
        if (!xiNghiep) {
          return res.status(400).json({
            message: "Thiếu tên Khu vực/Xí nghiệp khi chọn tất cả phòng ban!",
          });
        }
        const kvResult = await pool
          .request()
          .input("TenKhuVuc", sql.NVarChar(100), xiNghiep)
          .query(
            `SELECT MaKhuVuc FROM [dbo].[KHUVUC] WHERE TenKhuVuc = @TenKhuVuc`,
          );

        const kvRow = kvResult.recordset[0];
        if (
          !kvRow ||
          !allowedKhuVuc.map((k) => k.trim()).includes(kvRow.MaKhuVuc.trim())
        ) {
          return res.status(403).json({
            message: `Bạn không có quyền xem dữ liệu của đơn vị: ${xiNghiep}!`,
          });
        }
      } else if (maPhongBan) {
        const pbCheck = await pool
          .request()
          .input("MaPhongBan", sql.VarChar(50), maPhongBan)
          .query(
            `SELECT MaKhuVuc FROM [dbo].[PHONGBAN] WHERE MaPhongBan = @MaPhongBan`,
          );
        const pbRow = pbCheck.recordset[0];
        if (!pbRow) {
          return res.status(404).json({ message: "Không tìm thấy phòng ban!" });
        }
        const maKhuVuc = pbRow.MaKhuVuc.trim();
        const cleanAllowedKhuVuc = allowedKhuVuc.map((k) => k.trim());
        const cleanAllowedPhongBan = allowedPhongBan.map((p) => p.trim());
        if (
          !cleanAllowedPhongBan.includes(maPhongBan.trim()) &&
          !cleanAllowedKhuVuc.includes(maKhuVuc)
        ) {
          return res.status(403).json({
            message: "Bạn không có quyền truy cập dữ liệu của phòng ban này!",
          });
        }
      }
    }

    let employees = [];
    let rawCheckins = [];

    // EMPLOYEE CODE SEARCH PATH
    if (searchCode) {
      if (!/^\d+$/.test(searchCode)) {
        return res.status(400).json({ message: "Mã chấm công không hợp lệ!" });
      }
      const codeNum = Number(searchCode);

      // Query employee with exact code match
      const empResult = await pool
        .request()
        .input("MaChamCong", sql.Int, codeNum).query(`
          SELECT nv.MaChamCong, nv.TenNhanVien, pb.MaPhongBan, pb.MaKhuVuc, kv.TenKhuVuc
          FROM [dbo].[NHANVIEN] nv
          LEFT JOIN [dbo].[PHONGBAN] pb ON nv.MaPhongBan = pb.MaPhongBan
          LEFT JOIN [dbo].[KHUVUC] kv ON pb.MaKhuVuc = kv.MaKhuVuc
          WHERE nv.MaChamCong = @MaChamCong
        `);

      if (empResult.recordset.length === 0) {
        return res.json([]); // No matching employee
      }

      const employee = empResult.recordset[0];

      // Manager authorization check
      if (isManager && !isAdmin) {
        const empKhuVuc = employee.MaKhuVuc ? employee.MaKhuVuc.trim() : null;
        const empPhongBan = employee.MaPhongBan
          ? employee.MaPhongBan.trim()
          : null;
        const cleanAllowedKhuVuc = allowedKhuVuc.map((k) => k.trim());
        const cleanAllowedPhongBan = allowedPhongBan.map((p) => p.trim());

        const hasAccess =
          (empPhongBan && cleanAllowedPhongBan.includes(empPhongBan)) ||
          (empKhuVuc && cleanAllowedKhuVuc.includes(empKhuVuc));

        if (!hasAccess) {
          return res.status(403).json({
            message: "Bạn không có quyền xem dữ liệu nhân viên này!",
          });
        }
      }

      employees = empResult.recordset;

      // Fetch check-ins for this employee
      const checkinsResult = await pool
        .request()
        .input("MaChamCong", sql.Int, codeNum)
        .input("TuNgay", sql.VarChar(10), tuNgay)
        .input("DenNgay", sql.VarChar(10), denNgay).query(`
          SELECT c.MaChamCong, c.NgayCham, c.GioCham, c.MaSoMay, c.TenMay
          FROM [dbo].[CheckInOut] c
          WHERE c.MaChamCong = @MaChamCong
            AND c.NgayCham BETWEEN CAST(@TuNgay AS DATE) AND CAST(@DenNgay AS DATE)
          ORDER BY c.GioCham ASC
        `);
      rawCheckins = checkinsResult.recordset;
    } else {
      // DEPARTMENT MODE PATH
      if (!maPhongBan) {
        return res.status(400).json({ message: "Thiếu mã phòng ban!" });
      }

      // Hỗ trợ truy vấn toàn bộ phòng ban trong Xí nghiệp
      // Hỗ trợ truy vấn toàn bộ phòng ban trong Xí nghiệp/Khu vực
      let maPhongBanList = [];
      if (maPhongBan === "ALL") {
        if (!xiNghiep) {
          return res.status(400).json({
            message: "Thiếu tên Khu vực/Xí nghiệp khi chọn tất cả phòng ban!",
          });
        }

        // Lấy tất cả phòng ban trực thuộc TenKhuVuc được chọn
        const depResult = await pool
          .request()
          .input("TenKhuVuc", sql.NVarChar(100), xiNghiep).query(`
                    SELECT pb.MaPhongBan
                    FROM [dbo].[PHONGBAN] pb
                    INNER JOIN [dbo].[KHUVUC] kv ON pb.MaKhuVuc = kv.MaKhuVuc
                    WHERE kv.TenKhuVuc = @TenKhuVuc
                `);
        maPhongBanList = depResult.recordset.map((r) => r.MaPhongBan.trim());
      } else {
        maPhongBanList = [maPhongBan.trim()];
      }

      // 1. Lấy toàn bộ nhân viên thuộc các phòng ban này (Bổ sung thông tin Khu vực)
      const paramNames = maPhongBanList.map((_, i) => `@pb${i}`);
      const employeesRequest = pool.request();
      maPhongBanList.forEach((pb, i) => {
        employeesRequest.input(`pb${i}`, sql.VarChar(50), pb);
      });

      const employeesResult = await employeesRequest.query(`
            SELECT nv.MaChamCong, nv.TenNhanVien, pb.MaKhuVuc, kv.TenKhuVuc
            FROM [dbo].[NHANVIEN] nv
            LEFT JOIN [dbo].[PHONGBAN] pb ON nv.MaPhongBan = pb.MaPhongBan
            LEFT JOIN [dbo].[KHUVUC] kv ON pb.MaKhuVuc = kv.MaKhuVuc
            WHERE nv.MaPhongBan IN (${paramNames.join(", ")})
            ORDER BY nv.TenNhanVien ASC
        `);
      employees = employeesResult.recordset;

      // 2. Lấy dữ liệu chấm công thô từ CheckInOut cho các nhân viên này trong khoảng ngày
      const checkinsRequest = pool
        .request()
        .input("TuNgay", sql.VarChar(10), tuNgay)
        .input("DenNgay", sql.VarChar(10), denNgay);

      maPhongBanList.forEach((pb, i) => {
        checkinsRequest.input(`pb${i}`, sql.VarChar(50), pb);
      });

      const checkinsResult = await checkinsRequest.query(`
            SELECT c.MaChamCong, c.NgayCham, c.GioCham, c.MaSoMay, c.TenMay
            FROM [dbo].[CheckInOut] c
            INNER JOIN [dbo].[NHANVIEN] nv ON c.MaChamCong = nv.MaChamCong
            WHERE nv.MaPhongBan IN (${paramNames.join(", ")})
              AND c.NgayCham BETWEEN CAST(@TuNgay AS DATE) AND CAST(@DenNgay AS DATE)
            ORDER BY c.GioCham ASC
        `);
      rawCheckins = checkinsResult.recordset;
    }

    // 3. Gom nhóm dữ liệu chấm công theo MaChamCong và NgayCham (sử dụng UTC Date để tránh lệch múi giờ)
    const checkinsMap = {};
    const getUTCDateString = (dateObj) => {
      const year = dateObj.getUTCFullYear();
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    rawCheckins.forEach((row) => {
      const macc = row.MaChamCong;
      const dateStr = getUTCDateString(row.NgayCham);
      const key = `${macc}_${dateStr}`;
      if (!checkinsMap[key]) {
        checkinsMap[key] = [];
      }
      checkinsMap[key].push(row);
    });

    // 4. Tạo danh sách các ngày trong khoảng tuNgay -> denNgay (ở múi giờ UTC chuẩn)
    const getDatesInRange = (startDateStr, endDateStr) => {
      const dates = [];
      const [sYr, sMon, sDay] = startDateStr.split("-").map(Number);
      const [eYr, eMon, eDay] = endDateStr.split("-").map(Number);

      let start = Date.UTC(sYr, sMon - 1, sDay);
      const end = Date.UTC(eYr, eMon - 1, eDay);

      while (start <= end) {
        dates.push(new Date(start));
        start += 24 * 60 * 60 * 1000;
      }
      return dates;
    };
    const datesInRange = getDatesInRange(tuNgay, denNgay);

    // 5. Hàm kiểm tra đi trễ (so với mốc 07:30 AM) sử dụng getUTCHours/getUTCMinutes do mssql trả về Date dạng UTC
    const checkIsLate = (gioVaoDate) => {
      const hour = gioVaoDate.getUTCHours();
      const minute = gioVaoDate.getUTCMinutes();
      const totalMinutes = hour * 60 + minute;
      const standardMinutes = 7 * 60 + 30; // 07:30 AM
      if (totalMinutes > standardMinutes) {
        return { isLate: true, minutes: totalMinutes - standardMinutes };
      }
      return { isLate: false, minutes: 0 };
    };

    const daysOfWeek = ["CN", "Hai", "Ba", "Tư", "Năm", "Sáu", "Bảy"];

    // 6. Xây dựng báo cáo tổng hợp
    const report = [];

    for (const emp of employees) {
      for (const dateObj of datesInRange) {
        const dateStr = getUTCDateString(dateObj);
        const key = `${emp.MaChamCong}_${dateStr}`;
        const punches = checkinsMap[key] || [];

        let GioVao = null;
        let GioRa = null;
        let Cong = "0";
        let TongGio = "0";
        let KyHieu = "V";
        let TrangThai = "Vắng";
        let KhuVucVao = "";
        let KhuVucRa = "";

        if (punches.length === 1) {
          GioVao = punches[0].GioCham;
          const lateInfo = checkIsLate(GioVao);
          TrangThai = lateInfo.isLate
            ? `Trễ ${lateInfo.minutes} phút (Thiếu ra)`
            : "Đúng giờ (Thiếu ra)";
          KyHieu = "O";
          KhuVucVao = punches[0].TenMay
            ? punches[0].TenMay.trim()
            : `Máy ${punches[0].MaSoMay}`;
        } else if (punches.length >= 2) {
          GioVao = punches[0].GioCham;
          GioRa = punches[punches.length - 1].GioCham;

          const diffMs = GioRa.getTime() - GioVao.getTime();
          const diffHours = diffMs / (1000 * 60 * 60);
          TongGio = diffHours.toFixed(2).replace(".", ",");

          if (diffHours >= 7.5) {
            Cong = "1";
            KyHieu = "X";
          } else if (diffHours >= 4.0) {
            Cong = "0,5";
            KyHieu = "N";
          } else {
            Cong = "0";
            KyHieu = "O";
          }

          const lateInfo = checkIsLate(GioVao);
          TrangThai = lateInfo.isLate
            ? `Trễ ${lateInfo.minutes} phút`
            : "Đúng giờ";
          KhuVucVao = punches[0].TenMay
            ? punches[0].TenMay.trim()
            : `Máy ${punches[0].MaSoMay}`;
          KhuVucRa = punches[punches.length - 1].TenMay
            ? punches[punches.length - 1].TenMay.trim()
            : `Máy ${punches[punches.length - 1].MaSoMay}`;
        }

        report.push({
          MaChamCong: emp.MaChamCong,
          TenNhanVien: emp.TenNhanVien,
          Ngay: dateObj,
          Thu: daysOfWeek[dateObj.getUTCDay()],
          GioVao: GioVao,
          GioRa: GioRa,
          Cong: Cong,
          TongGio: TongGio,
          KyHieu: KyHieu,
          TrangThai: TrangThai,
          KhuVucVao: KhuVucVao,
          KhuVucRa: KhuVucRa,
        });
      }
    }

    // Sắp xếp báo cáo theo Ngày tăng dần rồi đến Mã chấm công tăng dần
    report.sort((a, b) => {
      if (a.Ngay.getTime() !== b.Ngay.getTime()) {
        return a.Ngay.getTime() - b.Ngay.getTime();
      }
      return a.MaChamCong - b.MaChamCong;
    });

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [API 3.5]: Xuất báo cáo chấm công ra file Excel (.xlsx) chuẩn biểu mẫu THACO KLH
app.get("/api/bao-cao/export-excel", authenticate, async (req, res) => {
  let { maPhongBan, xiNghiep, tuNgay, denNgay } = req.query;

  if (!tuNgay || !denNgay) {
    return res.status(400).json({ message: "Thiếu tham số ngày tháng!" });
  }

  try {
    const decodedUser = req.user;
    const pool = await mitacoPool;

    const isAdmin = decodedUser.roles.includes("Admin");
    const isManager = decodedUser.roles.includes("Manager");

    if (!isAdmin && !isManager) {
      return res
        .status(403)
        .json({ message: "Bạn không có quyền xem báo cáo!" });
    }

    // Lọc theo phân quyền nếu là Manager và không phải Admin
    let allowedKhuVuc = [];
    let allowedPhongBan = [];
    if (isManager && !isAdmin) {
      try {
        if (decodedUser.allowedKhuVuc) {
          allowedKhuVuc = JSON.parse(decodedUser.allowedKhuVuc);
        }
      } catch (e) {
        console.error("Lỗi parse allowedKhuVuc:", e);
      }
      try {
        if (decodedUser.allowedPhongBan) {
          allowedPhongBan = JSON.parse(decodedUser.allowedPhongBan);
        }
      } catch (e) {
        console.error("Lỗi parse allowedPhongBan:", e);
      }

      if (allowedKhuVuc.length === 0 && allowedPhongBan.length === 0) {
        return res.status(403).json({
          message:
            "Tài khoản của bạn chưa được phân quyền xem bất kỳ bộ phận nào!",
        });
      }

      if (maPhongBan === "ALL") {
        if (!xiNghiep) {
          return res.status(400).json({
            message: "Thiếu tên Khu vực/Xí nghiệp khi chọn tất cả phòng ban!",
          });
        }
        const kvResult = await pool
          .request()
          .input("TenKhuVuc", sql.NVarChar(100), xiNghiep)
          .query(
            `SELECT MaKhuVuc FROM [dbo].[KHUVUC] WHERE TenKhuVuc = @TenKhuVuc`,
          );

        const kvRow = kvResult.recordset[0];
        if (
          !kvRow ||
          !allowedKhuVuc.map((k) => k.trim()).includes(kvRow.MaKhuVuc.trim())
        ) {
          return res.status(403).json({
            message: `Bạn không có quyền xem dữ liệu của đơn vị: ${xiNghiep}!`,
          });
        }
      } else {
        const pbCheck = await pool
          .request()
          .input("MaPhongBan", sql.VarChar(50), maPhongBan)
          .query(
            `SELECT MaKhuVuc FROM [dbo].[PHONGBAN] WHERE MaPhongBan = @MaPhongBan`,
          );
        const pbRow = pbCheck.recordset[0];
        if (!pbRow) {
          return res.status(404).json({ message: "Không tìm thấy phòng ban!" });
        }
        const maKhuVuc = pbRow.MaKhuVuc.trim();
        const cleanAllowedKhuVuc = allowedKhuVuc.map((k) => k.trim());
        const cleanAllowedPhongBan = allowedPhongBan.map((p) => p.trim());
        if (
          !cleanAllowedPhongBan.includes(maPhongBan.trim()) &&
          !cleanAllowedKhuVuc.includes(maKhuVuc)
        ) {
          return res.status(403).json({
            message: "Bạn không có quyền truy cập dữ liệu của phòng ban này!",
          });
        }
      }
    }

    if (!maPhongBan) {
      return res.status(400).json({ message: "Thiếu mã phòng ban!" });
    }

    // Hỗ trợ truy vấn toàn bộ phòng ban trong Xí nghiệp cho file Excel
    // Hỗ trợ truy vấn toàn bộ phòng ban trong Xí nghiệp cho file Excel
    let maPhongBanList = [];
    let tenPhongBan = "";
    if (maPhongBan === "ALL") {
      if (!xiNghiep) {
        return res.status(400).json({
          message: "Thiếu tên Khu vực/Xí nghiệp khi chọn tất cả phòng ban!",
        });
      }
      tenPhongBan = `Toàn bộ ${xiNghiep}`;

      const depResult = await pool
        .request()
        .input("TenKhuVuc", sql.NVarChar(100), xiNghiep).query(`
                    SELECT pb.MaPhongBan 
                    FROM [dbo].[PHONGBAN] pb
                    INNER JOIN [dbo].[KHUVUC] kv ON pb.MaKhuVuc = kv.MaKhuVuc
                    WHERE kv.TenKhuVuc = @TenKhuVuc
                `);
      maPhongBanList = depResult.recordset.map((r) => r.MaPhongBan.trim());
    } else {
      maPhongBanList = [maPhongBan.trim()];
      const pbResult = await pool
        .request()
        .input("MaPhongBan", sql.VarChar(50), maPhongBan).query(`
                    SELECT TenPhongBan FROM [dbo].[PHONGBAN] WHERE MaPhongBan = @MaPhongBan
                `);
      tenPhongBan = pbResult.recordset[0]
        ? pbResult.recordset[0].TenPhongBan.trim()
        : maPhongBan;
    }

    if (maPhongBanList.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy phòng ban hợp lệ để xuất!" });
    }

    // 1. Lấy toàn bộ nhân viên thuộc danh sách phòng ban này
    const paramNames = maPhongBanList.map((_, i) => `@pb${i}`);
    const employeesRequest = pool.request();
    maPhongBanList.forEach((pb, i) => {
      employeesRequest.input(`pb${i}`, sql.VarChar(50), pb);
    });

    const employeesResult = await employeesRequest.query(`
            SELECT MaChamCong, TenNhanVien, NgayVaoLamViec
            FROM [dbo].[NHANVIEN]
            WHERE MaPhongBan IN (${paramNames.join(", ")})
            ORDER BY TenNhanVien ASC
        `);
    const employees = employeesResult.recordset;

    if (employees.length === 0) {
      return res
        .status(404)
        .json({ message: "Không có dữ liệu nhân viên để xuất!" });
    }

    // 2. Lấy dữ liệu chấm công thô từ CheckInOut cho các nhân viên này trong khoảng ngày
    const checkinsRequest = pool
      .request()
      .input("TuNgay", sql.VarChar(10), tuNgay)
      .input("DenNgay", sql.VarChar(10), denNgay);

    maPhongBanList.forEach((pb, i) => {
      checkinsRequest.input(`pb${i}`, sql.VarChar(50), pb);
    });

    const checkinsResult = await checkinsRequest.query(`
            SELECT c.MaChamCong, c.NgayCham, c.GioCham, c.MaSoMay, c.TenMay
            FROM [dbo].[CheckInOut] c
            INNER JOIN [dbo].[NHANVIEN] nv ON c.MaChamCong = nv.MaChamCong
            WHERE nv.MaPhongBan IN (${paramNames.join(", ")})
              AND c.NgayCham BETWEEN CAST(@TuNgay AS DATE) AND CAST(@DenNgay AS DATE)
            ORDER BY c.GioCham ASC
        `);
    const rawCheckins = checkinsResult.recordset;

    // 3. Gom nhóm dữ liệu chấm công theo MaChamCong và NgayCham
    const checkinsMap = {};
    const getUTCDateString = (dateObj) => {
      const year = dateObj.getUTCFullYear();
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    rawCheckins.forEach((row) => {
      const macc = row.MaChamCong;
      const dateStr = getUTCDateString(row.NgayCham);
      const key = `${macc}_${dateStr}`;
      if (!checkinsMap[key]) {
        checkinsMap[key] = [];
      }
      checkinsMap[key].push(row);
    });

    // 4. Tạo danh sách các ngày trong khoảng tuNgay -> denNgay
    const getDatesInRange = (startDateStr, endDateStr) => {
      const dates = [];
      const [sYr, sMon, sDay] = startDateStr.split("-").map(Number);
      const [eYr, eMon, eDay] = endDateStr.split("-").map(Number);

      let start = Date.UTC(sYr, sMon - 1, sDay);
      const end = Date.UTC(eYr, eMon - 1, eDay);

      while (start <= end) {
        dates.push(new Date(start));
        start += 24 * 60 * 60 * 1000;
      }
      return dates;
    };
    const datesInRange = getDatesInRange(tuNgay, denNgay);

    // 5. Khởi tạo Workbook ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Bảng chấm công");
    worksheet.views = [{ showGridLines: true }];

    // Thiết lập độ rộng cột mặc định và cụ thể
    worksheet.columns = [
      { key: "STT", width: 6 },
      { key: "MaNV", width: 14 },
      { key: "HoTen", width: 26 },
      { key: "NgayVao", width: 14 },
    ];

    // Tạo thêm cột cho các ngày
    datesInRange.forEach((d, idx) => {
      worksheet.columns = [
        ...worksheet.columns,
        { key: `Day_${idx}`, width: 6 },
      ];
    });

    // Cột tổng hợp bên phải
    worksheet.columns = [
      ...worksheet.columns,
      { key: "CongChinh", width: 10 },
      { key: "TangCa", width: 10 },
      { key: "ChuNhat", width: 10 },
      { key: "TangCaCN", width: 12 },
      { key: "GhiChu", width: 12 },
    ];

    const totalCols = 4 + datesInRange.length + 5;

    // Dòng 2: Tiêu đề BẢNG CHẤM CÔNG THÁNG ... NĂM ...
    const [yr, mon] = tuNgay.split("-");
    worksheet.mergeCells(2, 1, 2, totalCols);
    const titleCell = worksheet.getCell(2, 1);
    titleCell.value = `BẢNG CHẤM CÔNG THÁNG ${Number(mon)} NĂM ${yr}`;
    titleCell.font = { name: "Times New Roman", bold: true, size: 16 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(2).height = 35;

    // Dòng 3: Metadata Công ty
    worksheet.getCell("A3").value = "Công ty: KOUNMOM";
    worksheet.getCell("A3").font = {
      name: "Times New Roman",
      bold: true,
      size: 11,
    };

    // Dòng 4: Metadata Phòng ban
    worksheet.getCell("A4").value = `BỘ PHẬN/XƯỞNG: ${tenPhongBan}`;
    worksheet.getCell("A4").font = {
      name: "Times New Roman",
      bold: true,
      size: 11,
    };
    worksheet.getRow(3).height = 20;
    worksheet.getRow(4).height = 20;

    // Dòng 5, 6, 7: Các tiêu đề bảng công (Headers)
    worksheet.mergeCells(5, 1, 7, 1);
    worksheet.getCell(5, 1).value = "STT";
    worksheet.mergeCells(5, 2, 7, 2);
    worksheet.getCell(5, 2).value = "MÃ NHÂN VIÊN";
    worksheet.mergeCells(5, 3, 7, 3);
    worksheet.getCell(5, 3).value = "HỌ VÀ TÊN";
    worksheet.mergeCells(5, 4, 7, 4);
    worksheet.getCell(5, 4).value = "Ngày Vào Làm";

    // Lưới ngày trong tháng
    const startDayColIdx = 5;
    const endDayColIdx = 4 + datesInRange.length;
    worksheet.mergeCells(5, startDayColIdx, 5, endDayColIdx);
    worksheet.getCell(5, startDayColIdx).value = "Ngày Trong Tháng";

    const weekdaysMap = ["CN", "T.2", "T.3", "T.4", "T.5", "T.6", "T.7"];
    datesInRange.forEach((d, idx) => {
      const colIdx = startDayColIdx + idx;
      worksheet.getCell(6, colIdx).value = d.getUTCDate();
      worksheet.getCell(7, colIdx).value = weekdaysMap[d.getUTCDay()];
    });

    // Tiêu đề tổng hợp bên phải
    worksheet.mergeCells(5, endDayColIdx + 1, 7, endDayColIdx + 1);
    worksheet.getCell(5, endDayColIdx + 1).value = "Công Chính";
    worksheet.mergeCells(5, endDayColIdx + 2, 7, endDayColIdx + 2);
    worksheet.getCell(5, endDayColIdx + 2).value = "Tăng Ca";
    worksheet.mergeCells(5, endDayColIdx + 3, 7, endDayColIdx + 3);
    worksheet.getCell(5, endDayColIdx + 3).value = "Chủ Nhật";
    worksheet.mergeCells(5, endDayColIdx + 4, 7, endDayColIdx + 4);
    worksheet.getCell(5, endDayColIdx + 4).value = "Tăng Ca Chủ Nhật";
    worksheet.mergeCells(5, endDayColIdx + 5, 7, endDayColIdx + 5);
    worksheet.getCell(5, endDayColIdx + 5).value = "Ghi Chú";

    // Style cho tiêu đề
    const headerStyle = {
      font: { name: "Times New Roman", bold: true, size: 9 },
      alignment: { horizontal: "center", vertical: "middle", wrapText: true },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEAEAEA" },
      },
      border: {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      },
    };

    // Áp dụng style cho tất cả ô tiêu đề (Rows 5-7)
    for (let r = 5; r <= 7; r++) {
      worksheet.getRow(r).height = 20;
      for (let c = 1; c <= totalCols; c++) {
        const cell = worksheet.getCell(r, c);
        cell.font = headerStyle.font;
        cell.alignment = headerStyle.alignment;
        cell.fill = headerStyle.fill;
        cell.border = headerStyle.border;
      }
    }

    // 6. Điền dữ liệu cơ thể (Body)
    let currentRowIdx = 8;
    employees.forEach((emp, empIdx) => {
      const startRow = currentRowIdx;
      const endRow = currentRowIdx + 1;

      // Gộp dọc thông tin nhân viên
      worksheet.mergeCells(startRow, 1, endRow, 1);
      worksheet.mergeCells(startRow, 2, endRow, 2);
      worksheet.mergeCells(startRow, 3, endRow, 3);
      worksheet.mergeCells(startRow, 4, endRow, 4);

      worksheet.getCell(startRow, 1).value = empIdx + 1;
      worksheet.getCell(startRow, 2).value = emp.MaChamCong;
      worksheet.getCell(startRow, 3).value = emp.TenNhanVien;

      let ngayVaoStr = "--";
      if (emp.NgayVaoLamViec) {
        const nvDate = new Date(emp.NgayVaoLamViec);
        const day = String(nvDate.getUTCDate()).padStart(2, "0");
        const month = String(nvDate.getUTCMonth() + 1).padStart(2, "0");
        const year = nvDate.getUTCFullYear();
        ngayVaoStr = `${day}/${month}/${year}`;
      }
      worksheet.getCell(startRow, 4).value = ngayVaoStr;

      // Khởi tạo các giá trị tính tổng cho nhân viên
      let totalRegularWork = 0;
      let totalRegularOvertime = 0;
      let totalSundayWork = 0;
      let totalSundayOvertime = 0;

      // Điền lưới lịch tuần
      datesInRange.forEach((d, idx) => {
        const colIdx = startDayColIdx + idx;
        const key = `${emp.MaChamCong}_${getUTCDateString(d)}`;
        const punches = checkinsMap[key] || [];

        let KyHieu = "";
        let Cong = 0;
        let Overtime = 0;
        const isSunday = d.getUTCDay() === 0;

        if (punches.length === 1) {
          KyHieu = "O";
          Cong = 0;
          Overtime = 0;
        } else if (punches.length >= 2) {
          const GioVao = punches[0].GioCham;
          const GioRa = punches[punches.length - 1].GioCham;
          const diffHours =
            (GioRa.getTime() - GioVao.getTime()) / (1000 * 60 * 60);

          if (diffHours >= 7.5) {
            Cong = 1;
            KyHieu = "1";
          } else if (diffHours >= 4.0) {
            Cong = 0.5;
            KyHieu = "0,5";
          } else {
            Cong = 0;
            KyHieu = "O";
          }

          // Tính tăng ca
          if (diffHours > 8.0) {
            Overtime = Math.round((diffHours - 8.0) * 2) / 2; // Làm tròn tới 0.5
          }
        }

        // Cộng dồn tương ứng
        if (isSunday) {
          totalSundayWork += Cong;
          totalSundayOvertime += Overtime;
          if (Cong > 0) {
            worksheet.getCell(startRow, colIdx).value = KyHieu;
          }
        } else {
          totalRegularWork += Cong;
          totalRegularOvertime += Overtime;
          worksheet.getCell(startRow, colIdx).value = KyHieu || "";
        }

        // Ghi số giờ tăng ca xuống hàng B (Overtime row)
        worksheet.getCell(endRow, colIdx).value = Overtime > 0 ? Overtime : "";
      });

      // Ghi kết quả tổng hợp (Gộp dọc)
      worksheet.mergeCells(
        startRow,
        endDayColIdx + 1,
        endRow,
        endDayColIdx + 1,
      );
      worksheet.getCell(startRow, endDayColIdx + 1).value = totalRegularWork;

      worksheet.mergeCells(
        startRow,
        endDayColIdx + 2,
        endRow,
        endDayColIdx + 2,
      );
      worksheet.getCell(startRow, endDayColIdx + 2).value =
        totalRegularOvertime;

      worksheet.mergeCells(
        startRow,
        endDayColIdx + 3,
        endRow,
        endDayColIdx + 3,
      );
      worksheet.getCell(startRow, endDayColIdx + 3).value = totalSundayWork;

      worksheet.mergeCells(
        startRow,
        endDayColIdx + 4,
        endRow,
        endDayColIdx + 4,
      );
      worksheet.getCell(startRow, endDayColIdx + 4).value = totalSundayOvertime;

      worksheet.mergeCells(
        startRow,
        endDayColIdx + 5,
        endRow,
        endDayColIdx + 5,
      );
      worksheet.getCell(startRow, endDayColIdx + 5).value = "";

      // Định dạng style cho body cells của nhân viên
      const bodyBorder = {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      };

      for (let r = startRow; r <= endRow; r++) {
        worksheet.getRow(r).height = 18;
        for (let c = 1; c <= totalCols; c++) {
          const cell = worksheet.getCell(r, c);
          cell.font = { name: "Times New Roman", size: 9 };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = bodyBorder;
        }
      }

      // Căn lề riêng cho cột Tên nhân viên (cột 3) lệch trái
      worksheet.getCell(startRow, 3).alignment = {
        horizontal: "left",
        vertical: "middle",
      };

      currentRowIdx += 2;
    });

    // 7. Hàng TỔNG CỘNG
    const totalRowIdx = currentRowIdx;
    worksheet.mergeCells(totalRowIdx, 1, totalRowIdx, 4);
    worksheet.getCell(totalRowIdx, 1).value = "TỔNG CỘNG";
    worksheet.getCell(totalRowIdx, 1).font = {
      name: "Times New Roman",
      bold: true,
      size: 9,
    };
    worksheet.getCell(totalRowIdx, 1).alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    // Đặt viền đen và font bold cho hàng TỔNG CỘNG
    worksheet.getRow(totalRowIdx).height = 20;
    const totalBorder = {
      top: { style: "thin", color: { argb: "FF000000" } },
      left: { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
    };

    for (let c = 1; c <= totalCols; c++) {
      const cell = worksheet.getCell(totalRowIdx, c);
      cell.font = { name: "Times New Roman", bold: true, size: 9 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = totalBorder;
    }

    // Tính công thức tổng cộng
    // AJ, AK, AL, AM tương ứng với các cột tổng hợp
    const colLetterOfs = (idx) => {
      // idx bắt đầu từ 1
      let temp = "";
      let letterIdx = idx;
      while (letterIdx > 0) {
        let modulo = (letterIdx - 1) % 26;
        temp = String.fromCharCode(65 + modulo) + temp;
        letterIdx = Math.floor((letterIdx - modulo) / 26);
      }
      return temp;
    };

    const firstColSummaryIdx = endDayColIdx + 1;
    for (let offset = 0; offset < 4; offset++) {
      const colIdx = firstColSummaryIdx + offset;
      const colLetter = colLetterOfs(colIdx);
      worksheet.getCell(totalRowIdx, colIdx).value = {
        formula: `=SUM(${colLetter}8:${colLetter}${totalRowIdx - 1})`,
      };
    }

    // 8. Chữ ký (Signatures)
    const sigRowIdx = totalRowIdx + 3;
    worksheet.getRow(sigRowIdx).height = 22;

    // Khối Ban giám đốc (Cột C-F -> tương đương cột 3-6)
    worksheet.getCell(sigRowIdx, 3).value = "BAN GIÁM ĐỐC";
    worksheet.getCell(sigRowIdx, 3).font = {
      name: "Times New Roman",
      bold: true,
      size: 10,
    };
    worksheet.getCell(sigRowIdx, 3).alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    // Khối Giám đốc sản xuất
    const midCol = Math.floor(totalCols / 2);
    worksheet.getCell(sigRowIdx, midCol).value = "GIÁM ĐỐC SẢN XUẤT";
    worksheet.getCell(sigRowIdx, midCol).font = {
      name: "Times New Roman",
      bold: true,
      size: 10,
    };
    worksheet.getCell(sigRowIdx, midCol).alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    // Khối Người chấm công
    worksheet.getCell(sigRowIdx, totalCols - 2).value = "NGƯỜI CHẤM CÔNG";
    worksheet.getCell(sigRowIdx, totalCols - 2).font = {
      name: "Times New Roman",
      bold: true,
      size: 10,
    };
    worksheet.getCell(sigRowIdx, totalCols - 2).alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    // Trả file Excel về Client
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Bang-Cham-Cong-${encodeURIComponent(tenPhongBan)}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [API 3.6]: Xuất chi tiết chấm công ra file Excel (.xlsx) dạng bảng chi tiết từng ngày
app.get("/api/bao-cao/export-excel-detail", authenticate, async (req, res) => {
  let { maPhongBan, xiNghiep, tuNgay, denNgay } = req.query;

  if (!tuNgay || !denNgay) {
    return res.status(400).json({ message: "Thiếu tham số ngày tháng!" });
  }

  try {
    const decodedUser = req.user;
    const pool = await mitacoPool;

    const isAdmin = decodedUser.roles.includes("Admin");
    const isManager = decodedUser.roles.includes("Manager");

    if (!isAdmin && !isManager) {
      return res
        .status(403)
        .json({ message: "Bạn không có quyền xem báo cáo!" });
    }

    // Lọc theo phân quyền nếu là Manager và không phải Admin
    let allowedKhuVuc = [];
    let allowedPhongBan = [];
    if (isManager && !isAdmin) {
      try {
        if (decodedUser.allowedKhuVuc) {
          allowedKhuVuc = JSON.parse(decodedUser.allowedKhuVuc);
        }
      } catch (e) {
        console.error("Lỗi parse allowedKhuVuc:", e);
      }
      try {
        if (decodedUser.allowedPhongBan) {
          allowedPhongBan = JSON.parse(decodedUser.allowedPhongBan);
        }
      } catch (e) {
        console.error("Lỗi parse allowedPhongBan:", e);
      }

      if (allowedKhuVuc.length === 0 && allowedPhongBan.length === 0) {
        return res.status(403).json({
          message:
            "Tài khoản của bạn chưa được phân quyền xem bất kỳ bộ phận nào!",
        });
      }

      if (maPhongBan === "ALL") {
        if (!xiNghiep) {
          return res.status(400).json({
            message: "Thiếu tên Khu vực/Xí nghiệp khi chọn tất cả phòng ban!",
          });
        }
        const kvResult = await pool
          .request()
          .input("TenKhuVuc", sql.NVarChar(100), xiNghiep)
          .query(
            `SELECT MaKhuVuc FROM [dbo].[KHUVUC] WHERE TenKhuVuc = @TenKhuVuc`,
          );

        const kvRow = kvResult.recordset[0];
        if (
          !kvRow ||
          !allowedKhuVuc.map((k) => k.trim()).includes(kvRow.MaKhuVuc.trim())
        ) {
          return res.status(403).json({
            message: `Bạn không có quyền xem dữ liệu của đơn vị: ${xiNghiep}!`,
          });
        }
      } else {
        const pbCheck = await pool
          .request()
          .input("MaPhongBan", sql.VarChar(50), maPhongBan)
          .query(
            `SELECT MaKhuVuc FROM [dbo].[PHONGBAN] WHERE MaPhongBan = @MaPhongBan`,
          );
        const pbRow = pbCheck.recordset[0];
        if (!pbRow) {
          return res.status(404).json({ message: "Không tìm thấy phòng ban!" });
        }
        const maKhuVuc = pbRow.MaKhuVuc.trim();
        const cleanAllowedKhuVuc = allowedKhuVuc.map((k) => k.trim());
        const cleanAllowedPhongBan = allowedPhongBan.map((p) => p.trim());
        if (
          !cleanAllowedPhongBan.includes(maPhongBan.trim()) &&
          !cleanAllowedKhuVuc.includes(maKhuVuc)
        ) {
          return res.status(403).json({
            message: "Bạn không có quyền truy cập dữ liệu của phòng ban này!",
          });
        }
      }
    }

    if (!maPhongBan) {
      return res.status(400).json({ message: "Thiếu mã phòng ban!" });
    }

    // Hỗ trợ truy vấn toàn bộ phòng ban trong Xí nghiệp
    // Hỗ trợ truy vấn toàn bộ phòng ban trong Xí nghiệp cho file Excel chi tiết
    let maPhongBanList = [];
    let tenPhongBan = "";
    if (maPhongBan === "ALL") {
      if (!xiNghiep) {
        return res.status(400).json({
          message: "Thiếu tên Khu vực/Xí nghiệp khi chọn tất cả phòng ban!",
        });
      }
      tenPhongBan = `Toàn bộ ${xiNghiep}`;

      const depResult = await pool
        .request()
        .input("TenKhuVuc", sql.NVarChar(100), xiNghiep).query(`
                    SELECT pb.MaPhongBan 
                    FROM [dbo].[PHONGBAN] pb
                    INNER JOIN [dbo].[KHUVUC] kv ON pb.MaKhuVuc = kv.MaKhuVuc
                    WHERE kv.TenKhuVuc = @TenKhuVuc
                `);
      maPhongBanList = depResult.recordset.map((r) => r.MaPhongBan.trim());
    } else {
      maPhongBanList = [maPhongBan.trim()];
      const pbResult = await pool
        .request()
        .input("MaPhongBan", sql.VarChar(50), maPhongBan).query(`
                    SELECT TenPhongBan FROM [dbo].[PHONGBAN] WHERE MaPhongBan = @MaPhongBan
                `);
      tenPhongBan = pbResult.recordset[0]
        ? pbResult.recordset[0].TenPhongBan.trim()
        : maPhongBan;
    }

    if (maPhongBanList.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy phòng ban hợp lệ để xuất!" });
    }

    // 1. Lấy toàn bộ nhân viên thuộc danh sách phòng ban này
    const paramNames = maPhongBanList.map((_, i) => `@pb${i}`);
    const employeesRequest = pool.request();
    maPhongBanList.forEach((pb, i) => {
      employeesRequest.input(`pb${i}`, sql.VarChar(50), pb);
    });

    const employeesResult = await employeesRequest.query(`
            SELECT nv.MaChamCong, nv.TenNhanVien, pb.TenPhongBan, kv.TenKhuVuc
            FROM [dbo].[NHANVIEN] nv
            LEFT JOIN [dbo].[PHONGBAN] pb ON nv.MaPhongBan = pb.MaPhongBan
            LEFT JOIN [dbo].[KHUVUC] kv ON pb.MaKhuVuc = kv.MaKhuVuc
            WHERE nv.MaPhongBan IN (${paramNames.join(", ")})
            ORDER BY nv.TenNhanVien ASC
        `);
    const employees = employeesResult.recordset;

    if (employees.length === 0) {
      return res
        .status(404)
        .json({ message: "Không có dữ liệu nhân viên để xuất!" });
    }

    // 2. Lấy dữ liệu chấm công thô từ CheckInOut cho các nhân viên này trong khoảng ngày
    const checkinsRequest = pool
      .request()
      .input("TuNgay", sql.VarChar(10), tuNgay)
      .input("DenNgay", sql.VarChar(10), denNgay);

    maPhongBanList.forEach((pb, i) => {
      checkinsRequest.input(`pb${i}`, sql.VarChar(50), pb);
    });

    const checkinsResult = await checkinsRequest.query(`
            SELECT c.MaChamCong, c.NgayCham, c.GioCham, c.MaSoMay, c.TenMay
            FROM [dbo].[CheckInOut] c
            INNER JOIN [dbo].[NHANVIEN] nv ON c.MaChamCong = nv.MaChamCong
            WHERE nv.MaPhongBan IN (${paramNames.join(", ")})
              AND c.NgayCham BETWEEN CAST(@TuNgay AS DATE) AND CAST(@DenNgay AS DATE)
            ORDER BY c.GioCham ASC
        `);
    const rawCheckins = checkinsResult.recordset;

    // 3. Gom nhóm dữ liệu chấm công theo MaChamCong và NgayCham
    const checkinsMap = {};
    const getUTCDateString = (dateObj) => {
      const year = dateObj.getUTCFullYear();
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    rawCheckins.forEach((row) => {
      const macc = row.MaChamCong;
      const dateStr = getUTCDateString(row.NgayCham);
      const key = `${macc}_${dateStr}`;
      if (!checkinsMap[key]) {
        checkinsMap[key] = [];
      }
      checkinsMap[key].push(row);
    });

    // 4. Tạo danh sách các ngày trong khoảng tuNgay -> denNgay
    const getDatesInRange = (startDateStr, endDateStr) => {
      const dates = [];
      const [sYr, sMon, sDay] = startDateStr.split("-").map(Number);
      const [eYr, eMon, eDay] = endDateStr.split("-").map(Number);

      let start = Date.UTC(sYr, sMon - 1, sDay);
      const end = Date.UTC(eYr, eMon - 1, eDay);

      while (start <= end) {
        dates.push(new Date(start));
        start += 24 * 60 * 60 * 1000;
      }
      return dates;
    };
    const datesInRange = getDatesInRange(tuNgay, denNgay);

    // 5. Khởi tạo Workbook ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Chi tiết chấm công");
    worksheet.views = [{ showGridLines: true }];

    // Thiết lập tiêu đề cột
    worksheet.columns = [
      { header: "STT", key: "STT", width: 6 },
      { header: "Mã nhân viên", key: "MaNV", width: 14 },
      { header: "Tên nhân viên", key: "HoTen", width: 26 },
      { header: "Phòng ban", key: "PhongBan", width: 22 },
      { header: "Khu vực", key: "KhuVuc", width: 20 },
      { header: "Ngày", key: "Ngay", width: 14 },
      { header: "Thứ", key: "Thu", width: 8 },
      { header: "Giờ vào", key: "GioVao", width: 12 },
      { header: "Giờ ra", key: "GioRa", width: 12 },
      { header: "Trễ", key: "Tre", width: 8 },
      { header: "Sớm", key: "Som", width: 8 },
      { header: "Công", key: "Cong", width: 8 },
      { header: "Tổng giờ", key: "TongGio", width: 10 },
      { header: "Tăng ca", key: "TangCa", width: 10 },
      { header: "Tổng toàn bộ", key: "TongToanBo", width: 14 },
      { header: "Ca", key: "Ca", width: 8 },
    ];

    // Dòng 2: Tiêu đề CHI TIẾT CHẤM CÔNG
    worksheet.insertRow(1, []); // Chèn dòng trống
    worksheet.mergeCells(2, 1, 2, 16);
    const titleCell = worksheet.getCell(2, 1);
    titleCell.value = "CHI TIẾT CHẤM CÔNG";
    titleCell.font = { name: "Times New Roman", bold: true, size: 16 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(2).height = 35;

    // Dòng 4: Headers thực tế (ExcelJS tự động ghi header ở dòng được chỉ định)
    const headerRow = worksheet.getRow(4);
    headerRow.height = 25;

    const headers = [
      "STT",
      "Mã nhân viên",
      "Tên nhân viên",
      "Phòng ban",
      "Khu vực",
      "Ngày",
      "Thứ",
      "Giờ vào",
      "Giờ ra",
      "Trễ",
      "Sớm",
      "Công",
      "Tổng giờ",
      "Tăng ca",
      "Tổng toàn bộ",
      "Ca",
    ];

    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
    });

    const headerStyle = {
      font: { name: "Times New Roman", bold: true, size: 10 },
      alignment: { horizontal: "center", vertical: "middle" },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEAEAEA" },
      },
      border: {
        top: { style: "thin", color: { argb: "FF000000" } },
        left: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
      },
    };

    for (let c = 1; c <= 16; c++) {
      const cell = headerRow.getCell(c);
      cell.font = headerStyle.font;
      cell.alignment = headerStyle.alignment;
      cell.fill = headerStyle.fill;
      cell.border = headerStyle.border;
    }

    const weekdaysMap = ["Chủ Nhật", "Hai", "Ba", "Tư", "Năm", "Sáu", "Bảy"];
    let recordCount = 1;

    // 6. Điền dữ liệu chi tiết
    employees.forEach((emp) => {
      datesInRange.forEach((d) => {
        const rowData = {};
        const key = `${emp.MaChamCong}_${getUTCDateString(d)}`;
        const punches = checkinsMap[key] || [];

        let gioVaoStr = "";
        let gioRaStr = "";
        let treMin = 0;
        let somMin = 0;
        let congVal = 0;
        let tongGioVal = 0;
        let tangCaVal = 0;
        let tongToanBoVal = 0;
        let caVal = "V"; // Mặc định vắng

        if (punches.length === 1) {
          const GioVao = punches[0].GioCham;
          const hour = GioVao.getUTCHours();
          const minute = GioVao.getUTCMinutes();
          gioVaoStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

          // Tính trễ
          const totalMinutes = hour * 60 + minute;
          const standardMinutes = 7 * 60 + 30; // 07:30 AM
          if (totalMinutes > standardMinutes) {
            treMin = totalMinutes - standardMinutes;
          }
          caVal = "V"; // 1 punch thì vẫn coi là vắng hoặc thiếu
        } else if (punches.length >= 2) {
          const GioVao = punches[0].GioCham;
          const GioRa = punches[punches.length - 1].GioCham;

          const inHour = GioVao.getUTCHours();
          const inMin = GioVao.getUTCMinutes();
          gioVaoStr = `${String(inHour).padStart(2, "0")}:${String(inMin).padStart(2, "0")}`;

          const outHour = GioRa.getUTCHours();
          const outMin = GioRa.getUTCMinutes();
          gioRaStr = `${String(outHour).padStart(2, "0")}:${String(outMin).padStart(2, "0")}`;

          // Tính trễ
          const totalInMinutes = inHour * 60 + inMin;
          const standardInMinutes = 7 * 60 + 30; // 07:30 AM
          if (totalInMinutes > standardInMinutes) {
            treMin = totalInMinutes - standardInMinutes;
          }

          // Tính sớm (Standard checkout: 17:00)
          const totalOutMinutes = outHour * 60 + outMin;
          const standardOutMinutes = 17 * 60; // 05:00 PM
          if (totalOutMinutes < standardOutMinutes) {
            somMin = standardOutMinutes - totalOutMinutes;
          }

          const diffHours =
            (GioRa.getTime() - GioVao.getTime()) / (1000 * 60 * 60);
          if (diffHours >= 7.5) {
            congVal = 1;
            tongGioVal = 8;
          } else if (diffHours >= 4.0) {
            congVal = 0.5;
            tongGioVal = 4;
          } else {
            congVal = 0;
            tongGioVal = 0;
          }

          // Tính tăng ca
          if (diffHours > 8.0) {
            tangCaVal = Math.round((diffHours - 8.0) * 2) / 2;
          }

          tongToanBoVal = Math.round(diffHours * 100);
          caVal = "HC";
        }

        const dayVal = d.getUTCDate();
        const monthVal = d.getUTCMonth() + 1;
        const yearVal = d.getUTCFullYear();
        const dateFormatted = `${monthVal}/${dayVal}/${yearVal}`; // Định dạng M/D/YYYY như trong ảnh

        const nextRowIdx = worksheet.rowCount + 1;
        const newRow = worksheet.insertRow(nextRowIdx, [
          recordCount++,
          emp.MaChamCong,
          emp.TenNhanVien,
          emp.TenPhongBan ? emp.TenPhongBan.trim() : "",
          emp.TenKhuVuc ? emp.TenKhuVuc.trim() : "",
          dateFormatted,
          weekdaysMap[d.getUTCDay()],
          gioVaoStr,
          gioRaStr,
          treMin,
          somMin,
          congVal,
          tongGioVal,
          tangCaVal,
          tongToanBoVal,
          caVal,
        ]);

        // Định dạng style cho dòng dữ liệu
        newRow.height = 18;
        const bodyBorder = {
          top: { style: "thin", color: { argb: "FFD3D3D3" } },
          left: { style: "thin", color: { argb: "FFD3D3D3" } },
          bottom: { style: "thin", color: { argb: "FFD3D3D3" } },
          right: { style: "thin", color: { argb: "FFD3D3D3" } },
        };

        for (let c = 1; c <= 16; c++) {
          const cell = newRow.getCell(c);
          cell.font = { name: "Times New Roman", size: 9 };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = bodyBorder;
        }

        // Căn lề riêng cho các cột chữ
        newRow.getCell(3).alignment = {
          horizontal: "left",
          vertical: "middle",
        }; // Tên nv
        newRow.getCell(4).alignment = {
          horizontal: "left",
          vertical: "middle",
        }; // Phòng ban
      });
    });

    // Trả file Excel về Client
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Chi-Tiet-Cham-Cong-${encodeURIComponent(tenPhongBan)}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------------
// 3. CÁC API QUẢN TRỊ DÀNH CHO ADMIN (PHÂN QUYỀN VÀ LIÊN KẾT TÀI KHOẢN)
// -------------------------------------------------------------------------

// [API 4]: Lấy danh sách người dùng kèm theo danh sách vai trò
app.get(
  "/api/admin/users",
  authenticate,
  checkRole(["Admin"]),
  async (req, res) => {
    try {
      const pool = await authPool;
      const usersResult = await pool.request().query(`
            SELECT UserID, Username, FullName, MaChamCong, IsActive, AllowedKhuVuc, AllowedPhongBan
            FROM Web_Users
        `);
      const users = usersResult.recordset;

      const rolesResult = await pool.request().query(`
            SELECT ur.UserID, r.RoleID, r.RoleName
            FROM Web_UserRoles ur
            INNER JOIN Web_Roles r ON ur.RoleID = r.RoleID
        `);
      const userRoles = rolesResult.recordset;

      const usersWithRoles = users.map((user) => {
        const roles = userRoles
          .filter((ur) => ur.UserID === user.UserID)
          .map((ur) => ({ roleId: ur.RoleID, roleName: ur.RoleName }));
        return {
          ...user,
          roles,
        };
      });

      res.json(usersWithRoles);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// [API 5]: Lấy danh sách vai trò hiện có trong hệ thống
app.get(
  "/api/admin/roles",
  authenticate,
  checkRole(["Admin"]),
  async (req, res) => {
    try {
      const pool = await authPool;
      const result = await pool.request().query(`
            SELECT RoleID, RoleName, Description
            FROM Web_Roles
        `);
      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// [API 6]: Lấy danh sách nhân viên từ database chấm công (để liên kết tài khoản)
app.get(
  "/api/admin/employees",
  authenticate,
  checkRole(["Admin"]),
  async (req, res) => {
    try {
      const pool = await mitacoPool;
      const result = await pool.request().query(`
            SELECT nv.MaChamCong, nv.TenNhanVien, nv.MaPhongBan, pb.TenPhongBan
            FROM [dbo].[NHANVIEN] nv
            LEFT JOIN [dbo].[PHONGBAN] pb ON nv.MaPhongBan = pb.MaPhongBan
            ORDER BY nv.TenNhanVien ASC
        `);
      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// [API 7]: Cập nhật phân quyền (vai trò, mã chấm công và phân quyền khối/phòng ban) của tài khoản
app.post(
  "/api/admin/update-user-auth",
  authenticate,
  checkRole(["Admin"]),
  async (req, res) => {
    const { userId, maChamCong, roleIds, allowedKhuVuc, allowedPhongBan } =
      req.body;

    if (!userId || !Array.isArray(roleIds)) {
      return res
        .status(400)
        .json({ message: "Thiếu thông tin người dùng hoặc vai trò!" });
    }

    const pool = await authPool;
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // 1. Cập nhật MaChamCong và Phân quyền trong Web_Users
      const requestUsers = new sql.Request(transaction);
      await requestUsers
        .input("UserID", sql.Int, userId)
        .input("MaChamCong", sql.Int, maChamCong || null)
        .input(
          "AllowedKhuVuc",
          sql.NVarChar(sql.MAX),
          allowedKhuVuc ? JSON.stringify(allowedKhuVuc) : null,
        )
        .input(
          "AllowedPhongBan",
          sql.NVarChar(sql.MAX),
          allowedPhongBan ? JSON.stringify(allowedPhongBan) : null,
        ).query(`
                UPDATE Web_Users 
                SET MaChamCong = @MaChamCong,
                    AllowedKhuVuc = @AllowedKhuVuc,
                    AllowedPhongBan = @AllowedPhongBan
                WHERE UserID = @UserID
            `);

      // 2. Xóa các vai trò cũ trong Web_UserRoles
      const requestDeleteRoles = new sql.Request(transaction);
      await requestDeleteRoles.input("UserID", sql.Int, userId).query(`
                DELETE FROM Web_UserRoles 
                WHERE UserID = @UserID
            `);

      // 3. Thêm các vai trò mới được chọn
      if (roleIds.length > 0) {
        for (const roleId of roleIds) {
          const requestAddRole = new sql.Request(transaction);
          await requestAddRole
            .input("UserID", sql.Int, userId)
            .input("RoleID", sql.Int, roleId).query(`
                        INSERT INTO Web_UserRoles (UserID, RoleID)
                        VALUES (@UserID, @RoleID)
                    `);
        }
      }

      await transaction.commit();
      res.json({ message: "Cập nhật phân quyền thành công!" });
    } catch (err) {
      try {
        await transaction.rollback();
      } catch (rollbackErr) {
        console.error("Rollback failed:", rollbackErr.message);
      }
      res.status(500).json({ error: err.message });
    }
  },
);

// [API 8]: Tạo người dùng mới và phân quyền trực tiếp (bao gồm phân quyền khối/phòng ban)
app.post(
  "/api/admin/create-user",
  authenticate,
  checkRole(["Admin"]),
  async (req, res) => {
    const {
      username,
      fullName,
      password,
      maChamCong,
      roleIds,
      allowedKhuVuc,
      allowedPhongBan,
    } = req.body;

    if (!username || !password || !fullName || !Array.isArray(roleIds)) {
      return res
        .status(400)
        .json({ message: "Thiếu thông tin tài khoản bắt buộc!" });
    }

    try {
      const pool = await authPool;

      // 1. Kiểm tra username đã tồn tại chưa
      const checkUser = await pool
        .request()
        .input("Username", sql.NVarChar(50), username).query(`
                SELECT UserID FROM Web_Users WHERE Username = @Username
            `);

      if (checkUser.recordset.length > 0) {
        return res
          .status(400)
          .json({ message: "Tên đăng nhập đã tồn tại trong hệ thống!" });
      }

      // 2. Băm mật khẩu
      const passwordHash = await bcrypt.hash(password, 10);

      // 3. Thực hiện tạo trong Transaction
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        // Thêm người dùng vào Web_Users
        const requestInsertUser = new sql.Request(transaction);
        const insertResult = await requestInsertUser
          .input("Username", sql.NVarChar(50), username)
          .input("FullName", sql.NVarChar(100), fullName)
          .input("PasswordHash", sql.NVarChar(255), passwordHash)
          .input("MaChamCong", sql.Int, maChamCong || null)
          .input(
            "AllowedKhuVuc",
            sql.NVarChar(sql.MAX),
            allowedKhuVuc ? JSON.stringify(allowedKhuVuc) : null,
          )
          .input(
            "AllowedPhongBan",
            sql.NVarChar(sql.MAX),
            allowedPhongBan ? JSON.stringify(allowedPhongBan) : null,
          ).query(`
                    INSERT INTO Web_Users (Username, FullName, PasswordHash, MaChamCong, IsActive, AllowedKhuVuc, AllowedPhongBan)
                    OUTPUT INSERTED.UserID
                    VALUES (@Username, @FullName, @PasswordHash, @MaChamCong, 1, @AllowedKhuVuc, @AllowedPhongBan)
                `);

        const newUserId = insertResult.recordset[0].UserID;

        // Thêm các vai trò cho người dùng vào Web_UserRoles
        if (roleIds.length > 0) {
          for (const roleId of roleIds) {
            const requestInsertRole = new sql.Request(transaction);
            await requestInsertRole
              .input("UserID", sql.Int, newUserId)
              .input("RoleID", sql.Int, roleId).query(`
                            INSERT INTO Web_UserRoles (UserID, RoleID)
                            VALUES (@UserID, @RoleID)
                        `);
          }
        }

        await transaction.commit();
        res.json({ message: "Tạo tài khoản người dùng thành công!" });
      } catch (err) {
        try {
          await transaction.rollback();
        } catch (rollbackErr) {
          console.error("Rollback failed:", rollbackErr.message);
        }
        throw err;
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// Khởi chạy Máy chủ Backend
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(
    `🚀 Server Backend đang chạy mượt mà tại cổng: http://localhost:${PORT}`,
  );
});
