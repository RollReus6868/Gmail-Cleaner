# Gmail Cleaner

Tool tự động dọn thư cũ trên Gmail cho Windows và macOS. Trình duyệt Gmail nằm ngay trong cửa sổ tool: bạn đăng nhập ở khung bên phải, tool đặt 100 thư mỗi trang, chọn hết và xóa theo từng mục, rồi dọn sạch Thùng rác. Tool tự kiểm tra và cài bản mới.

## Tải và cài

Vào trang [Releases](https://github.com/RollReus6868/Gmail-Cleaner/releases/latest), tải file hợp với máy:

| Máy của bạn | File |
|---|---|
| Windows 10/11 | `GmailCleaner-<phiên bản>-windows-setup.exe` |
| Mac chip Apple (M1 trở lên) | `GmailCleaner-<phiên bản>-mac-arm64.zip` |
| Mac chip Intel | `GmailCleaner-<phiên bản>-mac-x64.zip` |

**Windows:** chạy file setup. Nếu SmartScreen báo "Unknown publisher", bấm **More info** rồi **Run anyway** (file chưa mua chữ ký số nên Windows cảnh báo).

**macOS:** giải nén, kéo `GmailCleaner.app` vào thư mục **Applications** rồi mở. Lần đầu macOS sẽ chặn vì app chưa có chữ ký Apple: vào **System Settings > Privacy & Security**, kéo xuống bấm **Open Anyway**. Nếu vẫn không mở được, mở Terminal và chạy:

```
xattr -dr com.apple.quarantine /Applications/GmailCleaner.app
```

## Cách dùng

1. Đăng nhập Gmail ở khung trình duyệt bên phải như bình thường. Tool không biết và không lưu mật khẩu; lần sau không phải đăng nhập lại.
2. Chọn các mục cần xóa.
3. **Xóa từ trang**: Gmail được đặt 100 thư mỗi trang. Trang 1 = xóa hết. Trang 3 = giữ 200 thư mới nhất của mỗi mục, xóa phần cũ hơn.
4. Bấm **Bắt đầu xóa**. Muốn ngừng thì bấm **Dừng**.

## Lưu ý quan trọng

- **Dọn sạch Thùng rác** xóa vĩnh viễn mọi thư trong Thùng rác, kể cả thư bạn tự xóa trước đó. Lần chạy đầu nên tắt mục này, xem kết quả rồi hãy bật.
- Mục **Thư rác** cũng bị xóa vĩnh viễn ngay (Gmail không đưa qua Thùng rác).
- **Hộp thư đến**: nếu Gmail bật các thẻ danh mục thì đây là thẻ "Chính".
- Đừng bấm chuột trong khung Gmail khi tool đang chạy.
- Nếu Google báo "trình duyệt hoặc ứng dụng này có thể không an toàn" khi đăng nhập: bấm **Về Gmail** và thử lại; nếu vẫn bị, hãy báo lại.
- Nếu tool báo "không tìm thấy nút xóa / ô chọn tất cả": Google đã đổi giao diện Gmail. Các điểm nhận diện nằm ở đầu file `src/cleaner.js` (`SEL` và `TEXT`).

## Cập nhật

Mỗi lần mở, tool hỏi GitHub xem có bản mới không. Có thì hiện nhãn **Có bản mới**; vào trang **Cập nhật** bấm **Tải và cài**. Tool tải file, kiểm mã SHA-256, tự đóng, cài và mở lại.

## Gặp lỗi

Gửi kèm file log:

- Windows: `%APPDATA%\GmailCleaner\error.log`
- macOS: `~/Library/Application Support/GmailCleaner/error.log` và `update.log`

## Dành cho người phát triển

App Electron. Cần Node.js 22.

```
package.json     tên, phiên bản (nguồn duy nhất), cấu hình đóng gói
src/main.js      cửa sổ + khung Gmail nhúng (WebContentsView) + lệnh từ giao diện
src/cleaner.js   tự động hóa Gmail; mọi selector nằm trong SEL / TEXT
src/updater.js   tự cập nhật qua GitHub Releases
src/preload.js   cầu nối giao diện <-> tiến trình chính
ui/              mã nguồn giao diện (React + Tailwind, kiểu Youwee)  ->  npm run build:ui  ->  ui_dist/
tests/           updater-test.js, cleaner-main.js (Gmail giả lập), e2e-app.js, e2e-update.js, verify-ui.js
```

Chạy từ mã nguồn: `npm install` rồi `npm start`.

**Phát hành bản mới:** tăng `version` trong `package.json`, sửa `RELEASE_NOTES.md` (phải nhắc số phiên bản mới), đẩy lên `main`, chờ workflow **Build & Release** xanh, rồi Actions > Build & Release > Run workflow > tick **publish**.

Giao diện theo phong cách [Youwee](https://github.com/vanloctech/youwee) (MIT) — xem `NOTICE.md`.
