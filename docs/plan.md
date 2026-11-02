# Rencana kerja — Payus

> Dibuat 1 Nov 2026. Target: PayPal AI Hackathon, batas kirim **12 Nov 2026
> 12:00 PST** (13 Nov 03:00 WIB). Sisa waktu efektif: 11 hari.

## 1. Titik awal

Repo ini sudah berisi kerangka yang jalan dan terverifikasi (tipe, lint, 122
test, build 16 route):

- Login Privy + unlock passkey/PIN, master diturunkan di browser
- `@username` bertanda tangan Ed25519, diverifikasi pembayar
- Invoice (sekali & berulang + reminder + cron), payment link, request
  terenkripsi, API key merchant, webhook HMAC + retry + delivery log,
  widget embed
- Postgres + Drizzle, uang sebagai integer minor unit (`numeric(20,0)`)

Yang belum ada: **agen**. Jalur uang dan seluruh layar dashboard sudah jadi
(lihat Fase 1 dan Fase 5); Guardian dan agen-agennya yang belum.

## 2. Keputusan yang sudah dipegang

1. **LLM tidak pernah menggerakkan uang.** Agen mengusulkan JSON ber-skema,
   Guardian (fungsi deterministik) memutuskan, executor menjalankan.
2. **Angka selalu dari ledger**, bukan dari LLM. LLM hanya menyusun narasi
   di atas hasil query terparameter.
3. **Ledger double-entry**, satuan minor unit integer, tanpa float.
4. **Idempoten di mana-mana**: `event_id` unik untuk webhook masuk,
   `sender_batch_id` deterministik untuk payout.
5. **Persetujuan terikat isi usulan** (hash penerima+nominal+pos sumber),
   supaya usulan tak bisa berubah setelah disetujui.

## 3. Dua keputusan yang masih menunggu (blocking)

| Item | Kenapa blocking | Batas putus |
|---|---|---|
| Akses **Payouts** di sandbox PayPal | F-04, F-08, F-12 dan separuh laporan bergantung padanya | Hari 0 |
| Kebijakan **refund setelah settlement** | menentukan apakah butuh rolling reserve atau `merchant_payable` negatif | Hari 2 |

Fallback kalau Payouts tidak tersedia: settlement dicatat sebagai
`merchant_payable` di ledger + tombol "release" yang memanggil Payouts bila
ada, dan bila tidak, mencatat `payout.simulated` **dengan label eksplisit di
UI**. Demo tetap utuh dan klaimnya tetap jujur.

## 4. Jadwal

### Hari 0 — 1–2 Nov
- [x] `git init` + commit awal
- [x] Mongo → Postgres + Drizzle, seluruh modul diport
- [x] Postgres lokal menyala (`postgresql@17` via brew, keg-only: binary-nya
      perlu ditambahkan ke PATH), `createdb payus`, migrasi terpasang
- [x] 4 file test DB yang dulu skip sekarang jalan — dan langsung menemukan
      dua bug port yang tak pernah terlihat oleh typecheck:
      `isUniqueViolation` tidak melihat kode `23505` karena Drizzle
      membungkus error driver (jadi "nomor invoice sudah dipakai" bocor
      sebagai error mentah), dan satu test yang angkanya sendiri tidak
      konsisten. Keduanya diperbaiki; seluruh suite hijau tanpa skip
- [x] `.env.example` + `docs/setup.md` berisi `PAYPAL_ENV`,
      `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`,
      `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
- [ ] **Masih padamu:** cek akses Payouts di PayPal Developer Dashboard dan
      isi kredensial sandbox ke `web/.env.local`

### Fase 1 — 2 Nov · fondasi uang · **selesai**
- [x] `server/db/schema.ts`: `ledger_accounts`, `ledger_txns` (id
      deterministik = kunci idempotensi), `ledger_entries`
      (`debit_minor`/`credit_minor`), `payments`, `webhook_events`
      (`event_id` primary key), `outbox` → migrasi `0001_*.sql`
- [x] `server/modules/ledger/`: `post()` menolak Σdebit ≠ Σkredit **sebelum**
      menyentuh database, jadi ledger tak seimbang tidak bisa direpresentasikan;
      `balance()` membaca ke arah normal akun (aset dan kewajiban dua-duanya
      positif), `rawBalance()`, `balances()`, `trialBalance()`
- [x] Id akun diturunkan lewat helper `account.*`, bukan ditulis tangan:
      `pos:<owner>:<slug>`, `in_flight:<owner>`, `tax_reserve:<owner>`,
      `merchant_payable:<owner>`, `platform_fee`, `paypal_cash`, `psp_fee`
- [x] `server/lib/paypal.ts`: OAuth2 dengan cache token, Orders v2
      create/capture (pakai `paypal-request-id`, jadi retry tidak menagih
      dua kali), `getCapture`, verifikasi tanda tangan webhook
- [x] `app/api/webhooks/paypal/route.ts`: setiap kiriman diverifikasi ke
      PayPal, disimpan di bawah `event_id`, dan pekerjaan outbox ditulis
      dalam transaksi yang sama. Kiriman ulang → `duplicate: true`, nol efek
- [x] Worker outbox (`app/api/cron/outbox`) membaca capture **balik dari
      PayPal** lalu memanggil `recordCapture` → `applyInvoicePayment`:
      inilah sambungan yang menyalakan webhook merchant, notifikasi, dan
      email penerima. "Tandai lunas" di dashboard kini lewat jalur yang sama
- [x] Route pembayar: `POST /api/payments/paypal/orders` dan
      `.../orders/<id>/capture`

**Terbukti oleh test** (`test/ledger.test.ts`, `test/moneyPath.test.ts`, 14
test di Postgres asli, hanya `server/lib/paypal.ts` yang distub): capture →
invoice `paid` → entri ledger seimbang (`trialBalance() === 0n`); kirim ulang
event yang sama tidak berefek; **event id baru untuk capture yang sama juga
tidak menggandakan**; kiriman tanpa tanda tangan sah ditolak dan tidak
disimpan; job yang gagal diulang dengan tunda bertambah lalu diparkir.

Dua hal yang sengaja ditunda: `split_rules` pindah ke Fase 2 (tabel tanpa
pemakai adalah hutang), dan tombol bayar di `/i/<token>` tetap di Fase 5 —
artinya **pembayaran sandbox sungguhan belum pernah dijalankan**; itu
menunggu kredensial.

### Fase 2 — 3–5 Nov · split & settlement
- Tabel `split_rules` (dipindah dari Fase 1, dibuat bersama pemakainya)
- `features/split/`: evaluasi aturan (persen + nominal tetap, urutan
  prioritas, sisa ke pos default, sisa pembulatan dengan largest-remainder)
- Settlement merchant: pembayaran masuk dipecah → `platform_fee`,
  `tax_reserve`, `merchant_payable`
- Payout keluar via Payouts dengan `sender_batch_id = hash(payout_intent)`;
  status dipantau; gagal → dana kembali ke pos asal
- Jalur refund sesuai keputusan Hari 2

**Selesai jika:** satu pembayaran menghasilkan entri yang totalnya sama
dengan jumlah masuk, dan payout dua kali dengan intent sama hanya mengirim
satu batch.

### Fase 3 — 6–7 Nov · Guardian
- `features/guardian/`: limit per transaksi & per hari, allowlist penerima,
  penerima baru dan perubahan rekening payout butuh persetujuan,
  "harga janggal" = di luar `[min, 3× median kategori]`
- `proposals` + `approvals` di DB; approval menyimpan hash usulan
- Notifikasi + persetujuan via Telegram; usulan kedaluwarsa setelah N menit
- Audit log: usulan, model + versi prompt, keputusan Guardian, alasan

**Selesai jika:** usulan melanggar aturan ditolak dengan alasan tercatat;
usulan di atas ambang menunggu sampai disetujui/kedaluwarsa; mengubah
nominal setelah disetujui membatalkan approval.

### Fase 4 — 8–9 Nov · agen
Urutan sesuai nilai demo:
1. **Developer Agent (storefront)** — chat → konfigurasi JSON ber-skema →
   render template kita (Link Store, Produk Digital, Tip, Jasa) → publish
   `/{slug}`. Tanpa HTML bebas; harga lewat Guardian; file digital pakai
   signed URL kedaluwarsa
2. **Allocator** — usulkan split tiap dana masuk
3. **Payer** — bayar tagihan jatuh tempo, kurang saldo → usulkan tarik dari
   pos lain (lewat Guardian)
4. **Reporter** — ringkasan + laporan settlement dari query ledger
5. **Merchant Ops / Advisor** — kalau waktu sisa

Tiap agen punya 5–10 prompt uji dengan hasil yang diharapkan (lolos skema,
ditolak Guardian saat melanggar).

### Fase 5 — 10–11 Nov · UI, hosting, laporan
- [x] **Dikerjakan lebih awal (2 Nov).** Lima placeholder dashboard diganti
      layar nyata: overview (saldo langsung dari ledger, pembayaran
      terakhir, invoice terbaru), invoices (buat + tandai lunas + void +
      stop berulang), links, requests (disegel di browser), developers
      (API key sekali tampil, webhook, log pengiriman)
- [x] **Halaman `/i/<token>` dan `/pay/...` tersambung ke Orders.** Tombol
      PayPal memanggil route kita; membayar sebuah link menulis invoice
      lebih dulu, jadi jalur settlement-nya sama persis
- [ ] Tabel transaksi pakai **AG Grid** (syarat hadiah sponsor, harus
      terlihat di video)
- [ ] Storefront builder + pratinjau live
- Deploy ke **Render** + Postgres terkelola, cron invoice aktif
- Laporan: settlement harian, rekonsiliasi, ekspor CSV/PDF
  (`lib/invoicePdf.ts`, `lib/csv.ts`, `lib/download.ts` sudah ada, tinggal
  disambung)

### 12 Nov · kirim
- Video YouTube publik < 3 menit; momen **Guardian menolak** ditaruh di
  detik ~80–100
- README + deskripsi proyek + daftar tool AI, LICENSE terlihat di About
- Demo terhosting + instruksi run; buffer sisa untuk perbaikan

## 5. Garis potong (dipakai kalau tertinggal)

| Kalau tertinggal di | Yang dibuang |
|---|---|
| Fase 2 | Payout nyata → mode simulasi berlabel, demo tetap jalan |
| Fase 3 | Guardian tetap (ini inti), approval Telegram → tombol in-app |
| Fase 4 | Advisor, Merchant Ops, Collections; sisakan Developer Agent + Allocator + Guardian + Reporter |
| Fase 5 | Ekspor PDF, rekonsiliasi lanjutan; AG Grid **jangan** dibuang kalau masih mengejar hadiah sponsor |

Yang tidak dikerjakan sama sekali: yield/treasury, langganan, multi-mata-uang,
KYC, custody.

## 6. Hutang teknis repo, dijadwalkan

| Hutang | Ditutup di |
|---|---|
| ~~`reportPayment` tanpa pemanggil~~ | ✅ Fase 1 (worker outbox + `applyInvoicePayment`) |
| ~~5 layar dashboard placeholder~~ | ✅ 2 Nov |
| ~~Tidak ada UI pembuatan API key~~ | ✅ 2 Nov (Developers → API keys, persis seperti docs/api.md) |
| `features/embed/bridge.ts` yatim → iframe tak auto-resize & tak emit event | Fase 5 |
| 13 modul yatim (`invoicePdf`, `csv`, `download`, `PaymentQrDialog`, dll.) | dipakai di Fase 5, sisanya dihapus |
| `.gitbook.yaml` menunjuk `docs/SUMMARY.md` yang tidak ada | kapan saja |
| ~~Test DB belum pernah dijalankan hijau~~ | ✅ Hari 0 (146 test, nol skip) |

## 7. Risiko utama

1. **Akses Payouts** — mitigasi: fallback simulasi berlabel (§3)
2. **Scope 15 item P0 untuk 11 hari** — mitigasi: sisi merchant jadi hero,
   sisi pengguna cukup deposit → Allocator → Guardian
3. **IDR bukan mata uang transaksi PayPal** — demo USD, tampilan konversi
   IDR dengan kurs konstanta berlabel "informatif"
4. **Agen mengarang angka** — dicegah oleh §2.2: semua angka dari query
   ledger, LLM hanya menyusun kalimat
