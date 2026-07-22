const fs = require('fs');

const path = 'd:\\\\CongViec\\\\pm-cham-cong-v2\\\\Server\\\\server.js';
let content = fs.readFileSync(path, 'utf8');

const startMarker = '// [API 3.7]: Xuất file Excel THACO dựa trên trang hiển thị hiện tại (paginated/filtered)';
const endMarker = '// -------------------------------------------------------------------------';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker, startIdx);

if (startIdx === -1 || endIdx === -1) {
    console.error('Markers not found!');
    process.exit(1);
}

const newCode = `// [API 3.7]: Xuất file Excel THACO (chỉ cho những người hiển thị ở trang hiện tại)
app.post("/api/bao-cao/export-excel-thaco", authenticate, async (req, res) => {
  const { maChamCongs } = req.body;
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
      return res.status(403).json({ message: "Bạn không có quyền xem báo cáo!" });
    }

    let allowedKhuVuc = [];
    let allowedPhongBan = [];
    if (isManager && !isAdmin) {
      try {
        if (decodedUser.allowedKhuVuc) allowedKhuVuc = JSON.parse(decodedUser.allowedKhuVuc);
      } catch (e) {}
      try {
        if (decodedUser.allowedPhongBan) allowedPhongBan = JSON.parse(decodedUser.allowedPhongBan);
      } catch (e) {}

      if (allowedKhuVuc.length === 0 && allowedPhongBan.length === 0) {
        return res.status(403).json({
          message: "Tài khoản của bạn chưa được phân quyền xem bất kỳ bộ phận nào!",
        });
      }

      if (maPhongBan === "ALL") {
        if (!xiNghiep) {
          return res.status(400).json({ message: "Thiếu tên Khu vực/Xí nghiệp khi chọn tất cả phòng ban!" });
        }
        const kvResult = await pool
          .request()
          .input("TenKhuVuc", sql.NVarChar(100), xiNghiep)
          .query(\`SELECT MaKhuVuc FROM [dbo].[KHUVUC] WHERE TenKhuVuc = @TenKhuVuc\`);

        const kvRow = kvResult.recordset[0];
        if (!kvRow || !allowedKhuVuc.map((k) => k.trim()).includes(kvRow.MaKhuVuc.trim())) {
          return res.status(403).json({ message: \`Bạn không có quyền xem dữ liệu của đơn vị: \${xiNghiep}!\` });
        }
      } else {
        const pbCheck = await pool
          .request()
          .input("MaPhongBan", sql.VarChar(50), maPhongBan)
          .query(\`SELECT MaKhuVuc FROM [dbo].[PHONGBAN] WHERE MaPhongBan = @MaPhongBan\`);
        const pbRow = pbCheck.recordset[0];
        if (!pbRow) return res.status(404).json({ message: "Không tìm thấy phòng ban!" });
        
        const maKhuVuc = pbRow.MaKhuVuc.trim();
        const cleanAllowedKhuVuc = allowedKhuVuc.map((k) => k.trim());
        const cleanAllowedPhongBan = allowedPhongBan.map((p) => p.trim());
        if (!cleanAllowedPhongBan.includes(maPhongBan.trim()) && !cleanAllowedKhuVuc.includes(maKhuVuc)) {
          return res.status(403).json({ message: "Bạn không có quyền truy cập dữ liệu của phòng ban này!" });
        }
      }
    }

    if (!maPhongBan) return res.status(400).json({ message: "Thiếu mã phòng ban!" });

    let maPhongBanList = [];
    let tenPhongBan = "";
    if (maPhongBan === "ALL") {
      tenPhongBan = \`Toàn bộ \${xiNghiep}\`;
      const depResult = await pool
        .request()
        .input("TenKhuVuc", sql.NVarChar(100), xiNghiep)
        .query(\`
          SELECT pb.MaPhongBan 
          FROM [dbo].[PHONGBAN] pb
          INNER JOIN [dbo].[KHUVUC] kv ON pb.MaKhuVuc = kv.MaKhuVuc
          WHERE kv.TenKhuVuc = @TenKhuVuc
        \`);
      maPhongBanList = depResult.recordset.map((r) => r.MaPhongBan.trim());
    } else {
      maPhongBanList = [maPhongBan.trim()];
      const pbResult = await pool
        .request()
        .input("MaPhongBan", sql.VarChar(50), maPhongBan)
        .query(\`SELECT TenPhongBan FROM [dbo].[PHONGBAN] WHERE MaPhongBan = @MaPhongBan\`);
      tenPhongBan = pbResult.recordset[0] ? pbResult.recordset[0].TenPhongBan.trim() : maPhongBan;
    }

    if (maPhongBanList.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy phòng ban hợp lệ để xuất!" });
    }

    // 1. Lấy toàn bộ nhân viên thuộc danh sách phòng ban này
    const paramNames = maPhongBanList.map((_, i) => \`@pb\${i}\`);
    const employeesRequest = pool.request();
    maPhongBanList.forEach((pb, i) => employeesRequest.input(\`pb\${i}\`, sql.VarChar(50), pb));

    const employeesResult = await employeesRequest.query(\`
      SELECT MaChamCong, TenNhanVien 
      FROM [dbo].[NHANVIEN]
      WHERE MaPhongBan IN (\${paramNames.join(", ")})
      ORDER BY TenNhanVien ASC
    \`);
    
    let employees = employeesResult.recordset;
    
    // LỌC NHÂN VIÊN THEO DANH SÁCH HIỂN THỊ TRÊN MÀN HÌNH (maChamCongs)
    if (maChamCongs && maChamCongs.length > 0) {
        const stringMaChamCongs = maChamCongs.map(String);
        employees = employees.filter(emp => stringMaChamCongs.includes(String(emp.MaChamCong)));
    }

    if (employees.length === 0) {
      return res.status(404).json({ message: "Không có dữ liệu nhân viên để xuất!" });
    }

    // 2. Lấy dữ liệu chấm công thô từ CheckInOut cho các nhân viên này trong khoảng ngày
    const checkinsRequest = pool
      .request()
      .input("TuNgay", sql.VarChar(10), tuNgay)
      .input("DenNgay", sql.VarChar(10), denNgay);

    maPhongBanList.forEach((pb, i) => checkinsRequest.input(\`pb\${i}\`, sql.VarChar(50), pb));

    const checkinsResult = await checkinsRequest.query(\`
      SELECT c.MaChamCong, c.NgayCham, c.GioCham
      FROM [dbo].[CheckInOut] c
      INNER JOIN [dbo].[NHANVIEN] nv ON c.MaChamCong = nv.MaChamCong
      WHERE nv.MaPhongBan IN (\${paramNames.join(", ")})
        AND c.NgayCham BETWEEN CAST(@TuNgay AS DATE) AND CAST(@DenNgay AS DATE)
      ORDER BY c.GioCham ASC
    \`);
    
    let rawCheckins = checkinsResult.recordset;
    if (maChamCongs && maChamCongs.length > 0) {
        const stringMaChamCongs = maChamCongs.map(String);
        rawCheckins = rawCheckins.filter(c => stringMaChamCongs.includes(String(c.MaChamCong)));
    }

    // 3. Gom nhóm dữ liệu chấm công theo MaChamCong và NgayCham
    const checkinsMap = {};
    const getUTCDateString = (dateObj) => {
      const year = dateObj.getUTCFullYear();
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getUTCDate()).padStart(2, "0");
      return \`\${year}-\${month}-\${day}\`;
    };

    rawCheckins.forEach((row) => {
      const macc = row.MaChamCong;
      const dateStr = getUTCDateString(row.NgayCham);
      const key = \`\${macc}_\${dateStr}\`;
      if (!checkinsMap[key]) checkinsMap[key] = [];
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
    const worksheet = workbook.addWorksheet("ImportWorkDay");

    const colMap = { stt: 1, maNv: 2, hoTen: 3, ngay: 4, kyHieu: 5 };

    worksheet.columns = [
      { header: "STT", key: "stt", width: 8 },
      { header: "Mã nhân viên", key: "maNv", width: 15 },
      { header: "Tên nhân viên", key: "hoTen", width: 25 },
      { header: "Ngày công", key: "ngay", width: 15 },
      { header: "Ký hiệu", key: "kyHieu", width: 10 },
      { width: 5 }, { width: 5 }, { width: 5 },
      { header: "Ghi chú", width: 10 },
      { header: "Ghi chú", width: 20 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { name: "Arial", bold: true, size: 10 };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };

    for (let i = 1; i <= 5; i++) {
      const cell = headerRow.getCell(i);
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    }

    worksheet.getRow(2).getCell(9).value = "X";
    worksheet.getRow(2).getCell(10).value = "Đi làm toàn ca";
    worksheet.getRow(3).getCell(9).value = "X\\\\1";
    worksheet.getRow(3).getCell(10).value = "Đi làm nửa ca đầu";
    worksheet.getRow(4).getCell(9).value = "X\\\\2";
    worksheet.getRow(4).getCell(10).value = "Đi làm nửa ca sau";

    let dataStartRowIdx = 2;
    let recordIndex = 0;

    // 6. Điền dữ liệu vào sheet
    employees.forEach((emp) => {
      datesInRange.forEach((d) => {
        const key = \`\${emp.MaChamCong}_\${getUTCDateString(d)}\`;
        const punches = checkinsMap[key] || [];

        let kyHieuVal = "";

        if (punches.length >= 2) {
          const GioVao = punches[0].GioCham;
          const GioRa = punches[punches.length - 1].GioCham;
          const diffMs = GioRa.getTime() - GioVao.getTime();
          let diffHours = diffMs / (1000 * 60 * 60);

          // Trừ giờ nghỉ trưa 11:00-13:00 (UTC)
          const LUNCH_START_MIN = 11 * 60;
          const LUNCH_END_MIN = 13 * 60;
          const inMin = GioVao.getUTCHours() * 60 + GioVao.getUTCMinutes();
          const outMin = GioRa.getUTCHours() * 60 + GioRa.getUTCMinutes();
          const start = Math.min(inMin, outMin);
          const end = Math.max(inMin, outMin);
          const overlapStart = Math.max(start, LUNCH_START_MIN);
          const overlapEnd = Math.min(end, LUNCH_END_MIN);
          const overlap = overlapEnd - overlapStart;
          const lunchMinutes = overlap > 0 ? overlap : 0;
          
          diffHours -= lunchMinutes / 60;
          if (diffHours < 0) diffHours = 0;

          if (diffHours >= 7.5) {
            kyHieuVal = "X";
          } else if (diffHours >= 4.0) {
            const inHour = GioVao.getUTCHours();
            if (inHour < 12) {
              kyHieuVal = "X\\\\1";
            } else {
              kyHieuVal = "X\\\\2";
            }
          }
        }

        const targetRowIdx = dataStartRowIdx + recordIndex;
        const targetRow = worksheet.getRow(targetRowIdx);

        const setCellValue = (colIdx, val) => {
          const cell = targetRow.getCell(colIdx);
          cell.value = val === null || val === undefined ? "" : val;
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          cell.alignment = { vertical: 'middle' };
        };

        const dayVal = String(d.getUTCDate()).padStart(2, "0");
        const monthVal = String(d.getUTCMonth() + 1).padStart(2, "0");
        const yearVal = d.getUTCFullYear();
        const dateFormatted = \`\${monthVal}/\${dayVal}/\${yearVal}\`;

        setCellValue(colMap.stt, recordIndex + 1);
        setCellValue(colMap.maNv, emp.MaChamCong);
        setCellValue(colMap.hoTen, emp.TenNhanVien);
        setCellValue(colMap.ngay, dateFormatted);
        setCellValue(colMap.kyHieu, kyHieuVal);

        recordIndex++;
      });
    });

    let pbName = maPhongBan || "ALL";
    if (maPhongBan === "ALL") pbName = xiNghiep ? xiNghiep.replace(/\\s+/g, "-") : "ALL";

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", \`attachment; filename=ImportWorkDayDaily-\${encodeURIComponent(pbName)}.xlsx\`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
`;

const newContent = content.substring(0, startIdx) + newCode + '\n' + content.substring(endIdx);
fs.writeFileSync(path, newContent, 'utf8');
console.log("Successfully replaced server.js route");
