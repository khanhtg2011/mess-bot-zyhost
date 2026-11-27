# 🤖 Bot Messenger All-in-One (Tối ưu cho Zyhost Node.js)

Bot Messenger thuần **Node.js**, tiêu thụ chỉ **~60–120 MB RAM**, tự động xóa file tạm sau khi gửi (phù hợp tuyệt đối với container Zyhost `512MB RAM / 1GB Disk`).

## ✨ Tính năng đã tích hợp
* **AI & Tóm tắt:** `/ai <câu hỏi>` (hỗ trợ reply ảnh để đọc/dịch), `/tomtat` (tóm tắt 150 tin nhắn gần nhất).
* **Media & Voice:** `/tai <link>` & tự động bắt link **TikTok / Douyin / Reels / Shorts** gửi video không logo (tự nén bằng `ffmpeg` nếu >24MB, gửi xong xóa file tạm ngay), `/tts <chữ>` gửi voice đọc tiếng Việt.
* **Quản trị nhóm:** `/all`, `/chiateam`, `/chon`, `/welcome on|off`, `/antispam on|off`, `/autoreply add|del|list`.
* **Tiện ích & Game:** `/nhac <10m> <nội dung>`, `/sv` (kiểm tra trạng thái Haven & RAM bot), `/noitu` (nối từ), `/tx` (tài xỉu vui).

---

## 🚀 Hướng dẫn chạy trên Zyhost

1. **Tạo file `appstate.json`:**
   * Đăng nhập tài khoản Facebook phụ trên trình duyệt máy tính.
   * Dùng extension **C3C FBState** hoặc **Cookie-Editor** (xuất dạng JSON) lấy cookie rồi lưu thành file `appstate.json` đặt vào thư mục gốc của bot trên Zyhost.
2. **Tạo file `.env`** (copy từ `.env.example`):
   * Điền `GEMINI_API_KEY` (lấy miễn phí tại Google AI Studio) để dùng `/ai` và `/tomtat`.
3. **Cài đặt & Chạy trên Zyhost:**
   * Đặt `MAIN_FILE` trong Startup của Zyhost là `index.js`.
   * Bấm **Start** — Zyhost sẽ tự chạy `npm install` và `node index.js`!
