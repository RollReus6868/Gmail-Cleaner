// Cau noi voi tien trinh chinh cua Electron (src/preload.js gan window.gc).
export type Level = 'info' | 'ok' | 'warn' | 'error'
export type Update = {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'installing' | 'error'
  latest: string
  notes: string
  progress: number
  error: string
  manual: boolean // khong tu cai duoc -> chi mo trang tai ve
}
export type State = {
  status: 'idle' | 'run' | 'update'
  version: string
  update: Update
  account: string
  deleted: number
  section: string
  logs: { t: string; level: Level; msg: string }[]
}
export type Options = { sections: string[]; startPage: number; emptyTrash: boolean }

declare global {
  interface Window {
    gc?: { call: (cmd: string, payload?: unknown) => Promise<State>; onState: (cb: (s: State) => void) => void }
  }
}

const noUpdate: Update = { status: 'idle', latest: '', notes: '', progress: 0, error: '', manual: false }
export const emptyState: State = { status: 'idle', version: '', update: noUpdate, account: '', deleted: 0, section: '', logs: [] }

// Chi dung khi xem thu giao dien trong trinh duyet (them ?demo vao dia chi).
export const demoState: State = {
  status: 'run', account: 'ban@gmail.com', deleted: 300, section: 'Mạng xã hội',
  version: '1.0.0',
  update: { ...noUpdate, status: 'available', latest: '1.1.0', notes: '- Sửa nhận diện nút xóa của Gmail\n- Chạy nhanh hơn' },
  logs: [
    { t: '16:40:02', level: 'ok', msg: 'Đã đặt hiển thị 100 thư mỗi trang.' },
    { t: '16:40:05', level: 'info', msg: 'Hộp thư đến: bắt đầu xóa từ trang 3.' },
    { t: '16:40:19', level: 'ok', msg: 'Hộp thư đến: xong, đã xóa 200 cuộc trò chuyện.' },
    { t: '16:40:24', level: 'info', msg: 'Mạng xã hội: đã xóa 100 cuộc trò chuyện.' },
    { t: '16:40:26', level: 'warn', msg: 'Quảng cáo: không xác nhận được đang ở trang 3 — bỏ qua để an toàn.' },
    { t: '16:40:27', level: 'error', msg: 'Thùng rác: không tìm thấy nút xóa của Gmail.' },
  ],
}

export function call(cmd: string, payload?: unknown): Promise<State | null> {
  return window.gc ? window.gc.call(cmd, payload) : Promise.resolve(null)
}
