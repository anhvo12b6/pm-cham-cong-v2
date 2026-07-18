import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";

const getDefaultApiBase = () => {
  const hostname = window.location.hostname;
  // Nếu chạy dưới local hoặc mạng LAN, trỏ về cổng 3000 nội bộ
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname)
  ) {
    return "http://" + hostname + ":3000";
  }
  // Nếu chạy online (Vercel), mặc định trỏ thẳng về API Render
  return "https://pm-cham-cong-v2.onrender.com";
};

const API_BASE_RAW = import.meta.env.VITE_API_BASE || getDefaultApiBase();
const API_BASE = API_BASE_RAW.endsWith("/")
  ? API_BASE_RAW.slice(0, -1)
  : API_BASE_RAW;

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [userRoles, setUserRoles] = useState(
    JSON.parse(localStorage.getItem("roles") || "[]"),
  );
  const [allowedKhuVuc, setAllowedKhuVuc] = useState(
    JSON.parse(localStorage.getItem("allowedKhuVuc") || "[]"),
  );
  const [allowedPhongBan, setAllowedPhongBan] = useState(
    JSON.parse(localStorage.getItem("allowedPhongBan") || "[]"),
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [phongBans, setPhongBans] = useState([]);
  const [xiNghiepList, setXiNghiepList] = useState([]);
  const [selectedXiNghiep, setSelectedXiNghiep] = useState("");
  const [filteredPhongBans, setFilteredPhongBans] = useState([]);

  const [selectedPhong, setSelectedPhong] = useState("");
  const today = new Date();

  // Ngày cuối tháng trước
  const FirstDayPreviousMonth = new Date(
    today.getFullYear(),
    today.getMonth(),
    2,
  );

  const formatDate = (date) => {
    return date.toISOString().split("T")[0];
  };

  const [tuNgay, setTuNgay] = useState(formatDate(FirstDayPreviousMonth));
  const [denNgay, setDenNgay] = useState(formatDate(today));
  const [reportData, setReportData] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // Filter nâng cao báo cáo
  const [filterTrangThai, setFilterTrangThai] = useState("all");
  const [filterGioVaoTu, setFilterGioVaoTu] = useState("");
  const [filterGioVaoDen, setFilterGioVaoDen] = useState("");
  const [filterGioRaTu, setFilterGioRaTu] = useState("");
  const [filterGioRaDen, setFilterGioRaDen] = useState("");

  // States cho phân quyền (Admin)
  const [activeTab, setActiveTab] = useState("report"); // 'report' hoặc 'roles'
  const [users, setUsers] = useState([]);
  const [rolesList, setRolesList] = useState([]);
  const [employeesList, setEmployeesList] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [editRoleIds, setEditRoleIds] = useState([]);
  const [editMaChamCong, setEditMaChamCong] = useState("");
  const [editAllowedKhuVuc, setEditAllowedKhuVuc] = useState([]);
  const [editAllowedPhongBan, setEditAllowedPhongBan] = useState([]);

  // States cho Tạo tài khoản mới
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newMaChamCong, setNewMaChamCong] = useState("");
  const [newRoleIds, setNewRoleIds] = useState([]);
  const [newAllowedKhuVuc, setNewAllowedKhuVuc] = useState([]);
  const [newAllowedPhongBan, setNewAllowedPhongBan] = useState([]);

  const isManagerOnly =
    userRoles.includes("Manager") && !userRoles.includes("Admin");

  // Hàm Đăng Nhập
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_BASE}/api/auth/login`, {
        username,
        password,
      });
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("roles", JSON.stringify(res.data.roles));
      localStorage.setItem("allowedKhuVuc", res.data.allowedKhuVuc || "[]");
      localStorage.setItem("allowedPhongBan", res.data.allowedPhongBan || "[]");

      setToken(res.data.token);
      setUserRoles(res.data.roles);
      setAllowedKhuVuc(JSON.parse(res.data.allowedKhuVuc || "[]"));
      setAllowedPhongBan(JSON.parse(res.data.allowedPhongBan || "[]"));

      setActiveTab("report");
    } catch (err) {
      alert(err.response?.data?.message || "Đăng nhập thất bại!");
    }
  };

  // Hàm Đăng Xuất
  const handleLogout = () => {
    localStorage.clear();
    setToken("");
    setUserRoles([]);
    setAllowedKhuVuc([]);
    setAllowedPhongBan([]);
    setPhongBans([]);
    setXiNghiepList([]);
    setSelectedXiNghiep("");
    setSelectedPhong("");
    setReportData([]);
    setActiveTab("report");
  };

  // Kiểm tra đăng nhập SSO từ URL params khi khởi tạo
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get("token");
    const ssoRoles = params.get("roles");
    const ssoFullName = params.get("fullName");
    const ssoAllowedKhuVuc = params.get("allowedKhuVuc");
    const ssoAllowedPhongBan = params.get("allowedPhongBan");
    const ssoError = params.get("sso_error");

    if (ssoError) {
      alert("Đăng nhập SSO thất bại: " + decodeURIComponent(ssoError));
      // Xóa query params trên URL
      window.history.replaceState(null, "", window.location.pathname);
    } else if (ssoToken && ssoRoles) {
      try {
        const decodedRoles = JSON.parse(decodeURIComponent(ssoRoles));
        const decodedFullName = decodeURIComponent(ssoFullName || "");
        const decodedAllowedKhuVuc = decodeURIComponent(
          ssoAllowedKhuVuc || "[]",
        );
        const decodedAllowedPhongBan = decodeURIComponent(
          ssoAllowedPhongBan || "[]",
        );

        localStorage.setItem("token", ssoToken);
        localStorage.setItem("roles", JSON.stringify(decodedRoles));
        localStorage.setItem("allowedKhuVuc", decodedAllowedKhuVuc);
        localStorage.setItem("allowedPhongBan", decodedAllowedPhongBan);

        setToken(ssoToken);
        setUserRoles(decodedRoles);
        setAllowedKhuVuc(JSON.parse(decodedAllowedKhuVuc));
        setAllowedPhongBan(JSON.parse(decodedAllowedPhongBan));

        // Xóa query params trên URL để bảo mật và sạch địa chỉ
        window.history.replaceState(null, "", window.location.pathname);
      } catch (e) {
        console.error("Lỗi phân tích gói dữ liệu SSO:", e);
      }
    }
  }, []);

  // 1. Lấy danh sách phòng ban và gom nhóm cấp 1 theo trường TenKhuVuc từ DB
  useEffect(() => {
    if (!token) return;
    axios
      .get(`${API_BASE}/api/phong-ban`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setPhongBans(res.data);

        // Lọc loại bỏ trùng lặp và loại bỏ giá trị rỗng/null của tên khu vực
        const xnSet = new Set(
          res.data
            .map((p) => (p.TenKhuVuc ? p.TenKhuVuc.trim() : ""))
            .filter((name) => name !== ""),
        );
        const xns = Array.from(xnSet);
        setXiNghiepList(xns);

        // Nếu chỉ có duy nhất 1 Xí nghiệp, tự động chọn nó luôn
        if (xns.length === 1) {
          setSelectedXiNghiep(xns[0]);
        }
      })
      .catch((err) => {
        if (err.response && err.response.status === 401) {
          handleLogout();
        } else {
          alert(
            "Lỗi tải danh mục phòng ban: " +
              (err.response?.data?.message || err.message),
          );
        }
      });
  }, [token]);

  // 2. Lọc danh sách phòng ban cấp 2 chính xác theo Khu vực được chọn
  useEffect(() => {
    if (!selectedXiNghiep) {
      setFilteredPhongBans([]);
      setSelectedPhong("");
    } else {
      const filtered = phongBans.filter(
        (p) => p.TenKhuVuc && p.TenKhuVuc.trim() === selectedXiNghiep,
      );
      setFilteredPhongBans(filtered);

      // Tự động chọn nếu chỉ có duy nhất 1 phòng ban trong khu vực này
      if (filtered.length === 1) {
        setSelectedPhong(filtered[0].MaPhongBan);
      } else {
        setSelectedPhong("");
      }
    }
  }, [selectedXiNghiep, phongBans]);

  // Gọi API lấy báo cáo công (lấy dữ liệu gốc, filter sẽ xử lý ở frontend)
  const fetchReport = () => {
    if (!selectedPhong) return alert("Vui lòng chọn phòng ban!");

    const params = new URLSearchParams({
      maPhongBan: selectedPhong,
      xiNghiep: selectedXiNghiep || "",
      tuNgay,
      denNgay,
    });

    axios
      .get(`${API_BASE}/api/bao-cao/phong-ban?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setReportData(res.data);
        setCurrentPage(1);
      })
      .catch((err) => {
        alert(
          "Lỗi khi xem báo cáo: " +
            (err.response?.data?.message || err.message),
        );
      });
  };

  // Filter client-side trên dữ liệu đã load
  const filteredReportData = useMemo(() => {
    const parseTimeToMinutes = (timeStr) => {
      if (!timeStr) return null;
      const [h, m] = timeStr.split(":").map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };

    const getMinutesFromDateTimeString = (dateTimeStr) => {
      if (!dateTimeStr) return null;
      const d = new Date(dateTimeStr);
      if (Number.isNaN(d.getTime())) return null;
      return d.getHours() * 60 + d.getMinutes();
    };

    const gioVaoTuMin = parseTimeToMinutes(filterGioVaoTu);
    const gioVaoDenMin = parseTimeToMinutes(filterGioVaoDen);
    const gioRaTuMin = parseTimeToMinutes(filterGioRaTu);
    const gioRaDenMin = parseTimeToMinutes(filterGioRaDen);

    return reportData.filter((row) => {
      // 1) Filter trạng thái
      let matchTrangThai = true;
      if (filterTrangThai === "dung_gio") {
        matchTrangThai =
          typeof row.TrangThai === "string" &&
          row.TrangThai.startsWith("Đúng giờ");
      } else if (filterTrangThai === "di_tre") {
        matchTrangThai =
          typeof row.TrangThai === "string" && row.TrangThai.includes("Trễ");
      } else if (filterTrangThai === "vang") {
        matchTrangThai = row.TrangThai === "Vắng";
      } else if (filterTrangThai === "thieu_ra") {
        matchTrangThai =
          typeof row.TrangThai === "string" &&
          row.TrangThai.includes("Thiếu ra");
      }
      if (!matchTrangThai) return false;

      // 2) Filter giờ vào
      const gioVaoMin = getMinutesFromDateTimeString(row.GioVao);
      if (gioVaoTuMin !== null) {
        if (gioVaoMin === null || gioVaoMin < gioVaoTuMin) return false;
      }
      if (gioVaoDenMin !== null) {
        if (gioVaoMin === null || gioVaoMin > gioVaoDenMin) return false;
      }

      // 3) Filter giờ ra
      const gioRaMin = getMinutesFromDateTimeString(row.GioRa);
      if (gioRaTuMin !== null) {
        if (gioRaMin === null || gioRaMin < gioRaTuMin) return false;
      }
      if (gioRaDenMin !== null) {
        if (gioRaMin === null || gioRaMin > gioRaDenMin) return false;
      }

      return true;
    });
  }, [
    reportData,
    filterTrangThai,
    filterGioVaoTu,
    filterGioVaoDen,
    filterGioRaTu,
    filterGioRaDen,
  ]);

  // Xuất báo cáo công ra file Excel chuẩn biểu mẫu
  const handleExportExcel = () => {
    if (!selectedPhong) return alert("Vui lòng chọn phòng ban!");
    axios
      .get(
        `${API_BASE}/api/bao-cao/export-excel?maPhongBan=${selectedPhong}&xiNghiep=${selectedXiNghiep}&tuNgay=${tuNgay}&denNgay=${denNgay}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        },
      )
      .then((res) => {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement("a");
        link.href = url;

        const pbName =
          selectedPhong === "ALL"
            ? selectedXiNghiep.replace(/\s+/g, "-")
            : phongBans
                .find((p) => p.MaPhongBan === selectedPhong)
                ?.TenPhongBan.replace(/\s+/g, "-") || selectedPhong;

        link.setAttribute(
          "download",
          `Bang-Cham-Cong-${pbName}-${tuNgay}-den-${denNgay}.xlsx`,
        );
        document.body.appendChild(link);
        link.click();
        link.remove();
      })
      .catch((err) => {
        alert("Lỗi khi xuất file Excel: " + err.message);
      });
  };

  // Xuất chi tiết chấm công ra file Excel dạng danh sách từng ngày
  const handleExportExcelDetail = () => {
    if (!selectedPhong) return alert("Vui lòng chọn phòng ban!");
    axios
      .get(
        `${API_BASE}/api/bao-cao/export-excel-detail?maPhongBan=${selectedPhong}&xiNghiep=${selectedXiNghiep}&tuNgay=${tuNgay}&denNgay=${denNgay}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        },
      )
      .then((res) => {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement("a");
        link.href = url;

        const pbName =
          selectedPhong === "ALL"
            ? selectedXiNghiep.replace(/\s+/g, "-")
            : phongBans
                .find((p) => p.MaPhongBan === selectedPhong)
                ?.TenPhongBan.replace(/\s+/g, "-") || selectedPhong;

        link.setAttribute(
          "download",
          `Chi-Tiet-Cham-Cong-${pbName}-${tuNgay}-den-${denNgay}.xlsx`,
        );
        document.body.appendChild(link);
        link.click();
        link.remove();
      })
      .catch((err) => {
        alert("Lỗi khi xuất chi tiết chấm công: " + err.message);
      });
  };

  // Tải dữ liệu Admin khi chuyển sang tab phân quyền
  useEffect(() => {
    if (activeTab !== "roles" || !token) return;

    axios
      .get(`${API_BASE}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setUsers(res.data))
      .catch((err) => console.error("Lỗi lấy danh sách user:", err));

    axios
      .get(`${API_BASE}/api/admin/roles`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setRolesList(res.data))
      .catch((err) => console.error("Lỗi lấy danh sách roles:", err));

    axios
      .get(`${API_BASE}/api/admin/employees`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setEmployeesList(res.data))
      .catch((err) => console.error("Lỗi lấy danh sách nhân viên:", err));
  }, [activeTab, token]);

  const handleSaveUserAuth = () => {
    if (!editingUser) return;
    axios
      .post(
        `${API_BASE}/api/admin/update-user-auth`,
        {
          userId: editingUser.UserID,
          maChamCong: editMaChamCong ? Number(editMaChamCong) : null,
          roleIds: editRoleIds,
          allowedKhuVuc: editAllowedKhuVuc,
          allowedPhongBan: editAllowedPhongBan,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .then((res) => {
        alert(res.data.message);
        setEditingUser(null);
        // Tải lại danh sách user
        axios
          .get(`${API_BASE}/api/admin/users`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          .then((res) => setUsers(res.data));
      })
      .catch((err) =>
        alert(
          "Lỗi khi cập nhật phân quyền: " +
            (err.response?.data?.message || err.message),
        ),
      );
  };

  const resetCreateForm = () => {
    setNewUsername("");
    setNewFullName("");
    setNewPassword("");
    setNewMaChamCong("");
    setNewRoleIds([]);
    setNewAllowedKhuVuc([]);
    setNewAllowedPhongBan([]);
    setShowCreateModal(false);
  };

  const handleCreateUser = (e) => {
    e.preventDefault();
    if (!newUsername || !newPassword || !newFullName) {
      return alert("Vui lòng điền đầy đủ các trường bắt buộc!");
    }
    axios
      .post(
        `${API_BASE}/api/admin/create-user`,
        {
          username: newUsername,
          fullName: newFullName,
          password: newPassword,
          maChamCong: newMaChamCong ? Number(newMaChamCong) : null,
          roleIds: newRoleIds,
          allowedKhuVuc: newAllowedKhuVuc,
          allowedPhongBan: newAllowedPhongBan,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .then((res) => {
        alert(res.data.message);
        resetCreateForm();
        // Tải lại danh sách user
        axios
          .get(`${API_BASE}/api/admin/users`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          .then((res) => setUsers(res.data));
      })
      .catch((err) =>
        alert(
          "Lỗi khi tạo tài khoản: " +
            (err.response?.data?.message || err.message),
        ),
      );
  };

  if (!token) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div style={{ textAlign: "center", marginBottom: "18px" }}>
            <img
              src="/logo.png"
              alt="Logo THACO AGRI"
              style={{ height: "48px", objectFit: "contain" }}
            />
          </div>
          <h2 className="login-title" style={{ marginTop: 0 }}>
            Đăng nhập hệ thống
          </h2>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Tài khoản</label>
              <input
                type="text"
                placeholder="Tên đăng nhập"
                onChange={(e) => setUsername(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div className="form-group">
              <label>Mật khẩu</label>
              <input
                type="password"
                placeholder="Mật khẩu"
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <button type="submit" className="btn-primary">
              Đăng nhập
            </button>
          </form>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(filteredReportData.length / pageSize);
  const currentItems = filteredReportData.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        width: "100%",
      }}
    >
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img
            src="/logo.png"
            alt="Logo THACO"
            style={{ height: "36px", filter: "brightness(0) invert(1)" }}
          />
        </div>
        <h1 className="app-title">Báo cáo chấm công theo khối / phòng ban</h1>
        <button onClick={handleLogout} className="btn-logout">
          Đăng xuất
        </button>
      </header>

      <div className="container">
        {/* Điều hướng tab nếu là Admin */}
        {userRoles.includes("Admin") && (
          <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
            <button
              onClick={() => setActiveTab("report")}
              style={{
                padding: "8px 16px",
                backgroundColor: activeTab === "report" ? "#1b7e3e" : "#ffffff",
                color: activeTab === "report" ? "#ffffff" : "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                transition: "all 0.15s ease",
              }}
            >
              Báo cáo công
            </button>
            <button
              onClick={() => setActiveTab("roles")}
              style={{
                padding: "8px 16px",
                backgroundColor: activeTab === "roles" ? "#1b7e3e" : "#ffffff",
                color: activeTab === "roles" ? "#ffffff" : "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "14px",
                transition: "all 0.15s ease",
              }}
            >
              Quản lý phân quyền
            </button>
          </div>
        )}

        {activeTab === "report" ? (
          <>
            {/* THANH BỘ LỌC ĐA CẤP THÔNG MINH */}
            <div className="filter-card">
              <div className="filter-grid">
                <div className="filter-group">
                  <label>Chọn Khối/Xí nghiệp</label>
                  {isManagerOnly && xiNghiepList.length <= 1 ? (
                    <div className="filter-readonly-value">
                      {selectedXiNghiep || "--"}
                    </div>
                  ) : (
                    <select
                      value={selectedXiNghiep}
                      onChange={(e) => setSelectedXiNghiep(e.target.value)}
                      className="filter-select"
                    >
                      <option value="">-- Chọn xí nghiệp --</option>
                      {xiNghiepList.map((xn) => (
                        <option key={xn} value={xn}>
                          {xn}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="filter-group">
                  <label>Chọn Phòng ban</label>
                  {isManagerOnly && filteredPhongBans.length <= 1 ? (
                    <div className="filter-readonly-value">
                      {filteredPhongBans[0]
                        ? filteredPhongBans[0].TenPhongBan
                        : "--"}
                    </div>
                  ) : (
                    <select
                      value={selectedPhong}
                      onChange={(e) => setSelectedPhong(e.target.value)}
                      className="filter-select"
                      disabled={!selectedXiNghiep}
                    >
                      <option value="">-- Chọn phòng ban --</option>
                      {selectedXiNghiep &&
                        (!isManagerOnly ||
                          allowedKhuVuc
                            .map((k) => k.trim())
                            .includes(
                              phongBans
                                .find(
                                  (p) =>
                                    p.TenKhuVuc &&
                                    p.TenKhuVuc.trim() === selectedXiNghiep,
                                )
                                ?.MaKhuVuc?.trim(),
                            )) && (
                          <option value="ALL">-- Tất cả phòng ban --</option>
                        )}
                      {filteredPhongBans.map((pb) => (
                        <option key={pb.MaPhongBan} value={pb.MaPhongBan}>
                          {pb.TenPhongBan}{" "}
                          {pb.TenKhuVuc ? `(${pb.TenKhuVuc.trim()})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="filter-group">
                  <label>Từ ngày</label>
                  <input
                    type="date"
                    value={tuNgay}
                    onChange={(e) => setTuNgay(e.target.value)}
                    className="filter-input"
                  />
                </div>

                <div className="filter-group">
                  <label>Đến ngày</label>
                  <input
                    type="date"
                    value={denNgay}
                    onChange={(e) => setDenNgay(e.target.value)}
                    className="filter-input"
                  />
                </div>

                <div className="filter-group">
                  <label>Trạng thái</label>
                  <select
                    value={filterTrangThai}
                    onChange={(e) => setFilterTrangThai(e.target.value)}
                    className="filter-select"
                  >
                    <option value="all">-- Tất cả trạng thái --</option>
                    <option value="dung_gio">Đúng giờ</option>
                    <option value="di_tre">Đi trễ</option>
                    <option value="vang">Vắng</option>
                    <option value="thieu_ra">Thiếu ra</option>
                  </select>
                </div>

                <div className="filter-group">
                  <label>Giờ vào từ</label>
                  <input
                    type="time"
                    value={filterGioVaoTu}
                    onChange={(e) => setFilterGioVaoTu(e.target.value)}
                    className="filter-input"
                  />
                </div>

                <div className="filter-group">
                  <label>Giờ vào đến</label>
                  <input
                    type="time"
                    value={filterGioVaoDen}
                    onChange={(e) => setFilterGioVaoDen(e.target.value)}
                    className="filter-input"
                  />
                </div>

                <div className="filter-group">
                  <label>Giờ ra từ</label>
                  <input
                    type="time"
                    value={filterGioRaTu}
                    onChange={(e) => setFilterGioRaTu(e.target.value)}
                    className="filter-input"
                  />
                </div>

                <div className="filter-group">
                  <label>Giờ ra đến</label>
                  <input
                    type="time"
                    value={filterGioRaDen}
                    onChange={(e) => setFilterGioRaDen(e.target.value)}
                    className="filter-input"
                  />
                </div>

                <button onClick={fetchReport} className="btn-success">
                  Xem báo cáo
                </button>
                <button onClick={handleExportExcel} className="btn-excel">
                  Xuất Excel
                </button>
                <button
                  onClick={handleExportExcelDetail}
                  className="btn-excel"
                  style={{ backgroundColor: "#0284c7" }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.backgroundColor = "#0369a1")
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.backgroundColor = "#0284c7")
                  }
                >
                  Xuất Chi Tiết
                </button>
              </div>
            </div>

            {/* BẢNG HIỂN THỊ DỮ LIỆU BÁO CÁO TỨC THỜI */}
            <div className="table-container">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Mã CC</th>
                    <th>Tên Nhân Viên</th>
                    <th>Khu Vực</th> {/* Thêm Header Khu Vực */}
                    <th>Ngày</th>
                    <th>Thứ</th>
                    <th>Giờ Vào</th>
                    <th>Giờ Ra</th>
                    <th>Công</th>
                    <th>Tổng Giờ</th>
                    <th>Ký Hiệu</th>
                    <th>Trạng Thái</th>
                    <th>Khu Vực Vào</th>
                    <th>Khu Vực Ra</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReportData.length === 0 ? (
                    <tr>
                      <td colSpan="13" className="empty-state">
                        Không có dữ liệu hiển thị. Hãy chọn bộ lọc và bấm "Xem
                        báo cáo".
                      </td>
                    </tr>
                  ) : (
                    currentItems.map((row, index) => {
                      let badgeClass = "badge badge-gray";
                      if (row.TrangThai) {
                        if (row.TrangThai.includes("Trễ")) {
                          badgeClass = "badge badge-danger";
                        } else if (row.TrangThai.startsWith("Đúng giờ")) {
                          badgeClass = "badge badge-success";
                        } else if (row.TrangThai === "Vắng") {
                          badgeClass = "badge badge-gray";
                        } else if (row.TrangThai.includes("Thiếu ra")) {
                          badgeClass = "badge badge-warning";
                        }
                      }

                      return (
                        <tr key={index}>
                          <td>{row.MaChamCong}</td>
                          <td>{row.TenNhanVien}</td>
                          <td className={row.TenKhuVuc ? "" : "empty-cell"}>
                            {row.TenKhuVuc || "--"}
                          </td>{" "}
                          {/* Thêm Cột hiển thị Khu Vực Nhân Viên */}
                          <td>
                            {new Date(row.Ngay).toLocaleDateString("vi-VN")}
                          </td>
                          <td>{row.Thu}</td>
                          <td
                            className={
                              row.GioVao ? "text-time-in" : "empty-cell"
                            }
                          >
                            {row.GioVao
                              ? row.GioVao.substring(11, 19)
                              : "--:--"}
                          </td>
                          <td
                            className={
                              row.GioRa ? "text-time-out" : "empty-cell"
                            }
                          >
                            {row.GioRa ? row.GioRa.substring(11, 19) : "--:--"}
                          </td>
                          <td className="text-cong">{row.Cong}</td>
                          <td>{row.TongGio}</td>
                          <td>
                            <span
                              style={{
                                background: "#f3f4f6",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                border: "1px solid #e5e7eb",
                              }}
                            >
                              {row.KyHieu}
                            </span>
                          </td>
                          <td>
                            <span className={badgeClass}>{row.TrangThai}</span>
                          </td>
                          <td className={row.KhuVucVao ? "" : "empty-cell"}>
                            {row.KhuVucVao || "--"}
                          </td>
                          <td className={row.KhuVucRa ? "" : "empty-cell"}>
                            {row.KhuVucRa || "--"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {filteredReportData.length > 0 && (
              <div
                className="pagination-bar"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "16px",
                  padding: "0 4px",
                }}
              >
                <span style={{ fontSize: "13px", color: "#6b7280" }}>
                  Hiển thị {(currentPage - 1) * pageSize + 1} -{" "}
                  {Math.min(currentPage * pageSize, filteredReportData.length)}{" "}
                  trên tổng số {filteredReportData.length} kết quả
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    disabled={currentPage === 1}
                    onClick={() =>
                      setCurrentPage((prev) => Math.max(prev - 1, 1))
                    }
                    style={{
                      padding: "6px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      backgroundColor: "#ffffff",
                      cursor: currentPage === 1 ? "not-allowed" : "pointer",
                      opacity: currentPage === 1 ? 0.5 : 1,
                      fontSize: "13px",
                      color: "#374151",
                      transition: "all 0.15s ease",
                    }}
                  >
                    Trang trước
                  </button>
                  <span
                    style={{
                      fontSize: "13px",
                      color: "#374151",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 8px",
                      fontWeight: 500,
                    }}
                  >
                    Trang {currentPage} / {totalPages || 1}
                  </span>
                  <button
                    disabled={currentPage === totalPages || totalPages === 0}
                    onClick={() =>
                      setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                    }
                    style={{
                      padding: "6px 12px",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      backgroundColor: "#ffffff",
                      cursor:
                        currentPage === totalPages || totalPages === 0
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        currentPage === totalPages || totalPages === 0
                          ? 0.5
                          : 1,
                      fontSize: "13px",
                      color: "#374151",
                      transition: "all 0.15s ease",
                    }}
                  >
                    Trang sau
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* GIAO DIỆN QUẢN LÝ PHÂN QUYỀN */
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: "15px",
                  fontWeight: 500,
                  color: "#374151",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                Danh sách tài khoản hệ thống
              </h3>
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-success"
                style={{ height: "36px", padding: "0 16px", fontSize: "13px" }}
              >
                Thêm tài khoản mới
              </button>
            </div>

            <div className="table-container">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Tên Đăng Nhập</th>
                    <th>Họ Và Tên</th>
                    <th>Nhân Viên Chấm Công</th>
                    <th>Vai Trò (Roles)</th>
                    <th>Quyền Xem Bộ Phận</th>
                    <th>Hành Động</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="empty-state">
                        Đang tải danh sách người dùng...
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => {
                      const linkedEmp = employeesList.find(
                        (emp) => emp.MaChamCong === u.MaChamCong,
                      );
                      const displayEmp = linkedEmp
                        ? `${linkedEmp.TenNhanVien} (${u.MaChamCong} - ${linkedEmp.TenPhongBan || "Không rõ phòng"}${linkedEmp.TenKhuVuc ? ` | ${linkedEmp.TenKhuVuc.trim()}` : ""})`
                        : u.MaChamCong
                          ? `Mã CC: ${u.MaChamCong}`
                          : "--";

                      let parsedKVs = [];
                      let parsedPBs = [];
                      try {
                        parsedKVs = JSON.parse(u.AllowedKhuVuc || "[]");
                      } catch (e) {}
                      try {
                        parsedPBs = JSON.parse(u.AllowedPhongBan || "[]");
                      } catch (e) {}

                      const isUserAdmin = u.roles.some(
                        (r) => r.roleName === "Admin",
                      );

                      return (
                        <tr key={u.UserID}>
                          <td>{u.Username}</td>
                          <td>{u.FullName}</td>
                          <td>{displayEmp}</td>
                          <td>
                            {u.roles.map((r) => (
                              <span
                                key={r.roleId}
                                className="badge badge-success"
                                style={{ marginRight: "6px" }}
                              >
                                {r.roleName}
                              </span>
                            ))}
                            {u.roles.length === 0 && (
                              <span className="badge badge-gray">Staff</span>
                            )}
                          </td>
                          <td>
                            {isUserAdmin ? (
                              <span
                                className="badge badge-success"
                                style={{ backgroundColor: "#16a34a" }}
                              >
                                Tất cả hệ thống
                              </span>
                            ) : (
                              <>
                                {parsedKVs.map((kv) => {
                                  const kvName =
                                    phongBans.find(
                                      (p) =>
                                        p.MaKhuVuc &&
                                        p.MaKhuVuc.trim() === kv.trim(),
                                    )?.TenKhuVuc || kv;
                                  return (
                                    <span
                                      key={kv}
                                      className="badge badge-primary"
                                      style={{
                                        marginRight: "4px",
                                        backgroundColor: "#0284c7",
                                      }}
                                    >
                                      Khối: {kvName.replace("XN ", "")}
                                    </span>
                                  );
                                })}
                                {parsedPBs.map((pb) => {
                                  const pbName =
                                    phongBans.find(
                                      (p) => p.MaPhongBan.trim() === pb.trim(),
                                    )?.TenPhongBan || pb;
                                  return (
                                    <span
                                      key={pb}
                                      className="badge badge-warning"
                                      style={{
                                        marginRight: "4px",
                                        backgroundColor: "#ca8a04",
                                      }}
                                    >
                                      PB: {pbName}
                                    </span>
                                  );
                                })}
                                {parsedKVs.length === 0 &&
                                  parsedPBs.length === 0 && (
                                    <span
                                      style={{
                                        color: "#9ca3af",
                                        fontSize: "13px",
                                      }}
                                    >
                                      Chưa phân quyền
                                    </span>
                                  )}
                              </>
                            )}
                          </td>
                          <td>
                            <button
                              onClick={() => {
                                setEditingUser(u);
                                setEditRoleIds(u.roles.map((r) => r.roleId));
                                setEditMaChamCong(u.MaChamCong || "");
                                setEditAllowedKhuVuc(parsedKVs);
                                setEditAllowedPhongBan(parsedPBs);
                              }}
                              style={{
                                padding: "6px 12px",
                                background: "#ffffff",
                                border: "1px solid #d1d5db",
                                borderRadius: "6px",
                                cursor: "pointer",
                                fontSize: "13px",
                                transition: "all 0.15s ease",
                              }}
                              onMouseOver={(e) =>
                                (e.currentTarget.style.backgroundColor =
                                  "#f9fafb")
                              }
                              onMouseOut={(e) =>
                                (e.currentTarget.style.backgroundColor =
                                  "#ffffff")
                              }
                            >
                              Chỉnh sửa
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* POPUP MODAL CHỈNH SỬA PHÂN QUYỀN */}
        {editingUser && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.4)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "28px",
                borderRadius: "10px",
                width: "100%",
                maxWidth: "500px",
                maxHeight: "90vh",
                overflowY: "auto",
                boxShadow:
                  "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                boxSizing: "border-box",
              }}
            >
              <h3
                style={{
                  marginTop: 0,
                  marginBottom: "20px",
                  fontSize: "18px",
                  fontWeight: 500,
                }}
              >
                Cấp quyền tài khoản: {editingUser.Username}
              </h3>

              <div style={{ marginBottom: "18px", textAlign: "left" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "8px",
                    fontSize: "13px",
                    color: "#4b5563",
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                  }}
                >
                  Liên kết nhân viên
                </label>
                <select
                  value={editMaChamCong}
                  onChange={(e) => setEditMaChamCong(e.target.value)}
                  className="filter-select"
                  style={{ width: "100%" }}
                >
                  <option value="">-- Không liên kết nhân viên --</option>
                  {employeesList.map((emp) => (
                    <option key={emp.MaChamCong} value={emp.MaChamCong}>
                      {emp.TenNhanVien} ({emp.MaChamCong} -{" "}
                      {emp.TenPhongBan || "Không rõ phòng"}
                      {emp.TenKhuVuc ? ` | ${emp.TenKhuVuc.trim()}` : ""})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: "24px", textAlign: "left" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "10px",
                    fontSize: "13px",
                    color: "#4b5563",
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                  }}
                >
                  Vai trò (Roles)
                </label>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {rolesList.map((role) => {
                    const checked = editRoleIds.includes(role.RoleID);
                    return (
                      <label
                        key={role.RoleID}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          cursor: "pointer",
                          fontSize: "14px",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditRoleIds([...editRoleIds, role.RoleID]);
                            } else {
                              setEditRoleIds(
                                editRoleIds.filter((id) => id !== role.RoleID),
                              );
                            }
                          }}
                        />
                        <span>
                          {role.RoleName}{" "}
                          <small style={{ color: "#6b7280" }}>
                            ({role.Description})
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Phân quyền Bộ phận / Khối (chỉ hiện khi không phải Admin) */}
              {editRoleIds.some(
                (rid) =>
                  rolesList.find((r) => r.RoleID === rid)?.RoleName === "Admin",
              ) ? (
                <div
                  style={{
                    marginBottom: "20px",
                    padding: "10px",
                    backgroundColor: "#f0fdf4",
                    borderRadius: "6px",
                    border: "1px solid #bbf7d0",
                    fontSize: "13px",
                    color: "#166534",
                    textAlign: "left",
                  }}
                >
                  ✓ Tài khoản có vai trò Admin có toàn quyền xem tất cả Khối và
                  Phòng ban.
                </div>
              ) : (
                <>
                  {/* Checkboxes Khối/Xí nghiệp */}
                  <div style={{ marginBottom: "16px", textAlign: "left" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "13px",
                        color: "#4b5563",
                        textTransform: "uppercase",
                        letterSpacing: "0.03em",
                        fontWeight: "500",
                      }}
                    >
                      Quyền xem Khối/Xí nghiệp
                    </label>
                    <span
                      style={{
                        display: "block",
                        marginBottom: "8px",
                        fontSize: "12px",
                        color: "#6b7280",
                        fontStyle: "italic",
                      }}
                    >
                      (Tích chọn Khối sẽ cho phép xem TOÀN BỘ các phòng ban
                      thuộc Khối đó)
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "10px",
                        maxHeight: "100px",
                        overflowY: "auto",
                        border: "1px solid #d1d5db",
                        borderRadius: "6px",
                        padding: "8px",
                      }}
                    >
                      {Array.from(
                        new Set(
                          phongBans.map((p) =>
                            p.MaKhuVuc && p.TenKhuVuc
                              ? JSON.stringify({
                                  MaKhuVuc: p.MaKhuVuc.trim(),
                                  TenKhuVuc: p.TenKhuVuc.trim(),
                                })
                              : "",
                          ),
                        ),
                      )
                        .filter((s) => s !== "")
                        .map((s) => {
                          const kv = JSON.parse(s);
                          const isChecked = editAllowedKhuVuc.includes(
                            kv.MaKhuVuc,
                          );
                          return (
                            <label
                              key={kv.MaKhuVuc}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                cursor: "pointer",
                                fontSize: "13px",
                                width: "45%",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setEditAllowedKhuVuc([
                                      ...editAllowedKhuVuc,
                                      kv.MaKhuVuc,
                                    ]);
                                  } else {
                                    setEditAllowedKhuVuc(
                                      editAllowedKhuVuc.filter(
                                        (id) => id !== kv.MaKhuVuc,
                                      ),
                                    );
                                  }
                                }}
                              />
                              <span>{kv.TenKhuVuc.replace("XN ", "")}</span>
                            </label>
                          );
                        })}
                    </div>
                  </div>

                  {/* Checkboxes Phòng ban */}
                  <div style={{ marginBottom: "20px", textAlign: "left" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "4px",
                        fontSize: "13px",
                        color: "#4b5563",
                        textTransform: "uppercase",
                        letterSpacing: "0.03em",
                        fontWeight: "500",
                      }}
                    >
                      Quyền xem Phòng ban lẻ
                    </label>
                    <span
                      style={{
                        display: "block",
                        marginBottom: "8px",
                        fontSize: "12px",
                        color: "#6b7280",
                        fontStyle: "italic",
                      }}
                    >
                      (Chỉ tích các phòng lẻ này nếu KHÔNG tích chọn Khối tương
                      ứng ở trên)
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                        maxHeight: "150px",
                        overflowY: "auto",
                        border: "1px solid #d1d5db",
                        borderRadius: "6px",
                        padding: "8px",
                      }}
                    >
                      {phongBans.map((pb) => {
                        const isChecked = editAllowedPhongBan.includes(
                          pb.MaPhongBan,
                        );
                        return (
                          <label
                            key={pb.MaPhongBan}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              cursor: "pointer",
                              fontSize: "13px",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditAllowedPhongBan([
                                    ...editAllowedPhongBan,
                                    pb.MaPhongBan,
                                  ]);
                                } else {
                                  setEditAllowedPhongBan(
                                    editAllowedPhongBan.filter(
                                      (id) => id !== pb.MaPhongBan,
                                    ),
                                  );
                                }
                              }}
                            />
                            <span>
                              {pb.TenPhongBan}{" "}
                              <small style={{ color: "#6b7280" }}>
                                ({pb.TenKhuVuc?.trim()})
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "12px",
                }}
              >
                <button
                  onClick={() => setEditingUser(null)}
                  style={{
                    padding: "8px 16px",
                    border: "1px solid #d1d5db",
                    background: "#ffffff",
                    color: "#374151",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={handleSaveUserAuth}
                  style={{
                    padding: "8px 20px",
                    background: "#1b7e3e",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        )}

        {/* POPUP MODAL TẠO TÀI KHOẢN MỚI */}
        {showCreateModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.4)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              zIndex: 1000,
            }}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "28px",
                borderRadius: "10px",
                width: "100%",
                maxWidth: "500px",
                maxHeight: "90vh",
                overflowY: "auto",
                boxShadow:
                  "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                boxSizing: "border-box",
              }}
            >
              <h3
                style={{
                  marginTop: 0,
                  marginBottom: "20px",
                  fontSize: "18px",
                  fontWeight: 500,
                }}
              >
                Tạo tài khoản mới
              </h3>

              <form onSubmit={handleCreateUser}>
                <div style={{ marginBottom: "14px", textAlign: "left" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "6px",
                      fontSize: "13px",
                      color: "#4b5563",
                    }}
                  >
                    Tên đăng nhập *
                  </label>
                  <input
                    type="text"
                    placeholder="Nhập tên đăng nhập"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>

                <div style={{ marginBottom: "14px", textAlign: "left" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "6px",
                      fontSize: "13px",
                      color: "#4b5563",
                    }}
                  >
                    Họ và tên *
                  </label>
                  <input
                    type="text"
                    placeholder="Nhập họ và tên"
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>

                <div style={{ marginBottom: "14px", textAlign: "left" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "6px",
                      fontSize: "13px",
                      color: "#4b5563",
                    }}
                  >
                    Mật khẩu *
                  </label>
                  <input
                    type="password"
                    placeholder="Nhập mật khẩu"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>

                <div style={{ marginBottom: "14px", textAlign: "left" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "6px",
                      fontSize: "13px",
                      color: "#4b5563",
                    }}
                  >
                    Liên kết nhân viên
                  </label>
                  <select
                    value={newMaChamCong}
                    onChange={(e) => setNewMaChamCong(e.target.value)}
                    className="filter-select"
                    style={{ width: "100%" }}
                  >
                    <option value="">-- Không liên kết nhân viên --</option>
                    {employeesList.map((emp) => (
                      <option key={emp.MaChamCong} value={emp.MaChamCong}>
                        {emp.TenNhanVien} ({emp.MaChamCong} -{" "}
                        {emp.TenPhongBan || "Không rõ phòng"}
                        {emp.TenKhuVuc ? ` | ${emp.TenKhuVuc.trim()}` : ""})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: "20px", textAlign: "left" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "10px",
                      fontSize: "13px",
                      color: "#4b5563",
                      textTransform: "uppercase",
                      letterSpacing: "0.03em",
                    }}
                  >
                    Vai trò (Roles)
                  </label>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    {rolesList.map((role) => {
                      const checked = newRoleIds.includes(role.RoleID);
                      return (
                        <label
                          key={role.RoleID}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            cursor: "pointer",
                            fontSize: "14px",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewRoleIds([...newRoleIds, role.RoleID]);
                              } else {
                                setNewRoleIds(
                                  newRoleIds.filter((id) => id !== role.RoleID),
                                );
                              }
                            }}
                          />
                          <span>
                            {role.RoleName}{" "}
                            <small style={{ color: "#6b7280" }}>
                              ({role.Description})
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Phân quyền Bộ phận / Khối (chỉ hiện khi không phải Admin) */}
                {newRoleIds.some(
                  (rid) =>
                    rolesList.find((r) => r.RoleID === rid)?.RoleName ===
                    "Admin",
                ) ? (
                  <div
                    style={{
                      marginBottom: "20px",
                      padding: "10px",
                      backgroundColor: "#f0fdf4",
                      borderRadius: "6px",
                      border: "1px solid #bbf7d0",
                      fontSize: "13px",
                      color: "#166534",
                      textAlign: "left",
                    }}
                  >
                    ✓ Tài khoản có vai trò Admin có toàn quyền xem tất cả Khối
                    và Phòng ban.
                  </div>
                ) : (
                  <>
                    {/* Checkboxes Khối/Xí nghiệp */}
                    <div style={{ marginBottom: "16px", textAlign: "left" }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: "4px",
                          fontSize: "13px",
                          color: "#4b5563",
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                          fontWeight: "500",
                        }}
                      >
                        Quyền xem Khối/Xí nghiệp
                      </label>
                      <span
                        style={{
                          display: "block",
                          marginBottom: "8px",
                          fontSize: "12px",
                          color: "#6b7280",
                          fontStyle: "italic",
                        }}
                      >
                        (Tích chọn Khối sẽ cho phép xem TOÀN BỘ các phòng ban
                        thuộc Khối đó)
                      </span>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "10px",
                          maxHeight: "100px",
                          overflowY: "auto",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          padding: "8px",
                        }}
                      >
                        {Array.from(
                          new Set(
                            phongBans.map((p) =>
                              p.MaKhuVuc && p.TenKhuVuc
                                ? JSON.stringify({
                                    MaKhuVuc: p.MaKhuVuc.trim(),
                                    TenKhuVuc: p.TenKhuVuc.trim(),
                                  })
                                : "",
                            ),
                          ),
                        )
                          .filter((s) => s !== "")
                          .map((s) => {
                            const kv = JSON.parse(s);
                            const isChecked = newAllowedKhuVuc.includes(
                              kv.MaKhuVuc,
                            );
                            return (
                              <label
                                key={kv.MaKhuVuc}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  cursor: "pointer",
                                  fontSize: "13px",
                                  width: "45%",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setNewAllowedKhuVuc([
                                        ...newAllowedKhuVuc,
                                        kv.MaKhuVuc,
                                      ]);
                                    } else {
                                      setNewAllowedKhuVuc(
                                        newAllowedKhuVuc.filter(
                                          (id) => id !== kv.MaKhuVuc,
                                        ),
                                      );
                                    }
                                  }}
                                />
                                <span>{kv.TenKhuVuc.replace("XN ", "")}</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>

                    {/* Checkboxes Phòng ban */}
                    <div style={{ marginBottom: "20px", textAlign: "left" }}>
                      <label
                        style={{
                          display: "block",
                          marginBottom: "4px",
                          fontSize: "13px",
                          color: "#4b5563",
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                          fontWeight: "500",
                        }}
                      >
                        Quyền xem Phòng ban lẻ
                      </label>
                      <span
                        style={{
                          display: "block",
                          marginBottom: "8px",
                          fontSize: "12px",
                          color: "#6b7280",
                          fontStyle: "italic",
                        }}
                      >
                        (Chỉ tích các phòng lẻ này nếu KHÔNG tích chọn Khối
                        tương ứng ở trên)
                      </span>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          maxHeight: "150px",
                          overflowY: "auto",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          padding: "8px",
                        }}
                      >
                        {phongBans.map((pb) => {
                          const isChecked = newAllowedPhongBan.includes(
                            pb.MaPhongBan,
                          );
                          return (
                            <label
                              key={pb.MaPhongBan}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                cursor: "pointer",
                                fontSize: "13px",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setNewAllowedPhongBan([
                                      ...newAllowedPhongBan,
                                      pb.MaPhongBan,
                                    ]);
                                  } else {
                                    setNewAllowedPhongBan(
                                      newAllowedPhongBan.filter(
                                        (id) => id !== pb.MaPhongBan,
                                      ),
                                    );
                                  }
                                }}
                              />
                              <span>
                                {pb.TenPhongBan}{" "}
                                <small style={{ color: "#6b7280" }}>
                                  ({pb.TenKhuVuc?.trim()})
                                </small>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "12px",
                  }}
                >
                  <button
                    type="button"
                    onClick={resetCreateForm}
                    style={{
                      padding: "8px 16px",
                      border: "1px solid #d1d5db",
                      background: "#ffffff",
                      color: "#374151",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: "8px 20px",
                      background: "#1b7e3e",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    Tạo tài khoản
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
