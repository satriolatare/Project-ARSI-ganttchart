# Manajemen Proyek — Gantt Chart

Aplikasi manajemen proyek berbasis **Gantt Chart** yang berjalan sepenuhnya di browser
(tanpa server, tanpa build step). Semua data tersimpan otomatis di `localStorage`.

## Cara Menjalankan

Cukup buka `index.html` di browser (double-click). Atau jalankan server statis:

```bash
npm start            # http://localhost:8000
# atau
python -m http.server 8000
```

## Fitur

### 1. Task Management
- Tambah / edit / hapus tugas dan **sub-tugas** (hubungan parent–child, tugas ringkasan otomatis menghitung dari anaknya).
- **Durasi dalam hari kerja**, tanggal mulai, prioritas (Rendah/Sedang/Tinggi/Kritis), dan **warna indikator** bebas pilih.
- Progres (%) per tugas.

### 2. Predecessors & Timeline (Gantt Chart)
- Hubungan antar tugas: **Finish-to-Start (FS)** dan **Start-to-Start (SS)** beserta **jeda hari kerja (lag)**.
- Visualisasi Gantt Chart (SVG) dengan zoom harian–kuartalan, penanda akhir pekan/libur, panah dependensi, dan penanda jalur kritis.

### 3. Resource Management
- Pendaftaran anggota tim: **nama, email, peran, gaji** (per bulan) dan kapasitas.
- Alokasikan anggota ke tugas tertentu; lihat beban kerja & estimasi biaya.

### 4. Kalender Proyek
- Pengaturan **akhir pekan** (pilih hari apa saja yang non-kerja).
- Penambahan **hari libur khusus** (custom holiday) + pratinjau kalender bulanan.

### 5. Analisis Proyek
- **Critical Path Method (CPM)**: forward/backward pass, slack, dan penandaan **jalur kritis**.
- **Diagram PERT** dengan box ES/EF/LS/LF, durasi, slack, dan jalur kritis tersorot.

## Arsitektur

```
index.html            # entry point (muat skrip berurutan)
css/styles.css        # seluruh gaya
js/utils.js           # utilitas tanggal + kalender hari kerja (UTC)
js/store.js           # state, CRUD, persistence (localStorage), data contoh
js/scheduler.js       # mesin CPM: forward/backward pass, jalur kritis, deteksi siklus
js/gantt.js           # renderer Gantt Chart (SVG)
js/pert.js            # renderer diagram PERT (SVG)
js/app.js             # UI: tab, panel, modal, event wiring
test/logic.test.js    # uji logika kalender + CPM (Node)
test/ui.smoke.js       # uji asap UI headless (jsdom)
```

### Model penjadwalan
Penjadwalan sesungguhnya dilakukan pada **tugas daun (leaf)**. Tugas ringkasan
(parent) meng-agregasi ES/EF/LS/LF dari semua tugas daun di bawahnya. Bila sebuah
tugas menunjuk tugas ringkasan sebagai predecessor, edge-nya di-expand ke seluruh
tugas daun di bawahnya — sehingga tidak pernah terjadi lingkaran (siklus) antara
parent dan anaknya. Akhir pekan & hari libur sepenuhnya diperhitungkan dalam
perhitungan durasi, slack, dan penjadwalan.

## Menjalankan Pengujian

```bash
npm install        # hanya untuk jsdom (pengujian UI)
npm test           # logika + asap UI
npm run test:logic # hanya logika kalender & CPM
npm run test:ui    # hanya asap UI headless
```

## Ekspor / Impor

Menu **⚙** di kanan atas memungkinkan ekspor proyek ke JSON, impor dari JSON,
memuat ulang data contoh, atau mengosongkan proyek.
