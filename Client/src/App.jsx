import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const [phongBans, setPhongBans] = useState([]);
  const [xiNghiepList, setXiNghiepList] = useState([]);
  const [selectedXiNghiep, setSelectedXiNghiep] = useState('');
  const [filteredPhongBans, setFilteredPhongBans] = useState([]);
  
  const [selectedPhong, setSelectedPhong] = useState('');
  const [tuNgay, setTuNgay] = useState('2026-07-01');
  const [denNgay, setDenNgay] = useState('2026-07-07');
  const [reportData, setReportData] = useState([]);

  // Hàm Đăng Nhập
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post('http://localhost:3000/api/auth/login', { username, password });
      localStorage.setItem('token', res.data.token);
      setToken(res.data.token);
    } catch (err) { alert("Đăng nhập thất bại!"); }
  };

  // Lấy danh sách phòng ban và gom nhóm theo Xí nghiệp
  useEffect(() => {
    if (!token) return;
    axios.get('http://localhost:3000/api/phong-ban', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        setPhongBans(res.data);
        // Tách lấy tiền tố trước dấu "_" làm tên xí nghiệp (Ví dụ: DP1, LP3, XOÀI...)
        const xnSet = new Set(res.data.map(p => p.TenPhongBan.includes('_') ? p.TenPhongBan.split('_')[0] : 'Khối Văn Phòng'));
        setXiNghiepList(Array.from(xnSet));
      });
  }, [token]);

  // Lọc phòng ban cấp 2 khi cấp 1 (Xí nghiệp) thay đổi
  useEffect(() => {
    if (selectedXiNghiep === 'Khối Văn Phòng') {
      setFilteredPhongBans(phongBans.filter(p => !p.TenPhongBan.includes('_')));
    } else {
      setFilteredPhongBans(phongBans.filter(p => p.TenPhongBan.startsWith(selectedXiNghiep + '_')));
    }
    setSelectedPhong('');
  }, [selectedXiNghiep, phongBans]);

  // Gọi API lấy báo cáo công
  const fetchReport = () => {
    if (!selectedPhong) return alert("Vui lòng chọn phòng ban!");
    axios.get(`http://localhost:3000/api/bao-cao/phong-ban?maPhongBan=${selectedPhong}&tuNgay=${tuNgay}&denNgay=${denNgay}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => setReportData(res.data));
  };

  if (!token) {
    return (
      <div style={{ maxWidth: '400px', margin: '100px auto', padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
        <h2>ĐĂNG NHẬP HỆ THỐNG WEB</h2>
        <form onSubmit={handleLogin}>
          <input type="text" placeholder="Tài khoản" onChange={e => setUsername(e.target.value)} style={{ width: '100%', marginBottom: '10px', padding: '8px' }} required />
          <input type="password" placeholder="Mật khẩu" onChange={e => setPassword(e.target.value)} style={{ width: '100%', marginBottom: '20px', padding: '8px' }} required />
          <button type="submit" style={{ width: '100%', padding: '10px', background: '#007bff', color: 'white', border: 'none', cursor: 'pointer' }}>Đăng nhập</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>📊 BÁO CÁO CHẤM CÔNG THEO KHỐI / PHÒNG BAN</h2>
      <button onClick={() => { localStorage.clear(); setToken(''); }} style={{ float: 'right', background: 'red', color: 'white', border: 'none', padding: '5px 10px', cursor: 'pointer' }}>Đăng xuất</button>
      
      {/* THANH BỘ LỌC ĐA CẤP THÔNG MINH */}
      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '6px' }}>
        <div>
          <label>1. Chọn Khối/Xí nghiệp: </label><br/>
          <select value={selectedXiNghiep} onChange={e => setSelectedXiNghiep(e.target.value)} style={{ padding: '6px', width: '200px' }}>
            <option value="">-- Chọn xí nghiệp --</option>
            {xiNghiepList.map(xn => <option key={xn} value={xn}>{xn}</option>)}
          </select>
        </div>

        <div>
          <label>2. Chọn Phòng ban: </label><br/>
          <select value={selectedPhong} onChange={e => setSelectedPhong(e.target.value)} style={{ padding: '6px', width: '250px' }} disabled={!selectedXiNghiep}>
            <option value="">-- Chọn phòng ban cụ thể --</option>
            {filteredPhongBans.map(pb => <option key={pb.MaPhongBan} value={pb.MaPhongBan}>{pb.TenPhongBan}</option>)}
          </select>
        </div>

        <div>
          <label>Từ ngày: </label><br/>
          <input type="date" value={tuNgay} onChange={e => setTuNgay(e.target.value)} style={{ padding: '5px' }} />
        </div>

        <div>
          <label>Đến ngày: </label><br/>
          <input type="date" value={denNgay} onChange={e => setDenNgay(e.target.value)} style={{ padding: '5px' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={fetchReport} style={{ padding: '7px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>Xem báo cáo</button>
        </div>
      </div>

      {/* BẢNG HIỂN THỊ DỮ LIỆU BÁO CÁO TỨC THỜI */}
      <table border="1" cellPadding="8" cellSpacing="0" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
        <thead style={{ backgroundColor: '#007bff', color: 'white' }}>
          <tr>
            <th>Mã CC</th>
            <th>Tên Nhân Viên</th>
            <th>Ngày</th>
            <th>Thứ</th>
            <th>Giờ Vào</th>
            <th>Giờ Ra</th>
            <th>Công</th>
            <th>Tổng Giờ</th>
            <th>Ký Hiệu</th>
          </tr>
        </thead>
        <tbody>
          {reportData.length === 0 ? (
            <tr><td colSpan="9">Không có dữ liệu hiển thị. Hãy chọn bộ lọc và bấm "Xem báo cáo".</td></tr>
          ) : (
            reportData.map((row, index) => (
              <tr key={index} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f2f2f2' }}>
                <td>{row.MaChamCong}</td>
                <td style={{ textAlign: 'left' }}>{row.TenNhanVien}</td>
                <td>{new Date(row.Ngay).toLocaleDateString('vi-VN')}</td>
                <td>{row.Thu}</td>
                <td style={{ color: 'green', fontWeight: 'bold' }}>{row.GioVao ? row.GioVao.substring(11,19) : '--:--'}</td>
                <td style={{ color: 'blue', fontWeight: 'bold' }}>{row.GioRa ? row.GioRa.substring(11,19) : '--:--'}</td>
                <td style={{ color: '#ff5722', fontWeight: 'bold' }}>{row.Cong}</td>
                <td>{row.TongGio}</td>
                <td><span style={{ background: '#eee', padding: '2px 6px', borderRadius: '4px' }}>{row.KyHieu}</span></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}