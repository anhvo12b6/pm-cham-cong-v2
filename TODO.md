# TODO - Bổ sung filter báo cáo chấm công

- [x] 1. Cập nhật `Server/server.js`
  - [x] Thêm query params filter cho `/api/bao-cao/phong-ban`:
    - `trangThai`: all | dung_gio | di_tre | vang | thieu_ra
    - `gioVaoTu`, `gioVaoDen` (HH:mm)
    - `gioRaTu`, `gioRaDen` (HH:mm)
  - [x] Áp dụng filter sau khi build `report` và trước khi sort/return.

- [x] 2. Cập nhật `Client/src/App.jsx`
  - [x] Thêm state filter mới cho trạng thái, giờ vào, giờ ra.
  - [x] Thêm UI filter trong khu vực `filter-card`.
  - [x] Cập nhật `fetchReport()` để gửi query params filter lên backend.

- [x] 3. Cập nhật tiến độ TODO sau mỗi bước hoàn thành

- [ ] 4. Kiểm tra nhanh build/chạy để xác nhận không lỗi cú pháp
