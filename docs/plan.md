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

Yang belum ada: **jalur uang**. `invoices.reportPayment` tidak dipanggil
siapa pun, jadi tidak ada invoice yang bisa jadi `paid`, dan 5 layar
dashboard masih placeholder.

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

### Hari 0 — 1 Nov (hari ini)
- [x] `git init` + commit awal
- [x] Mongo → Postgres + Drizzle, seluruh modul diport
- [ ] Nyalakan Postgres lokal, jalankan 4 file test DB yang sekarang skip
      (`brew install postgresql@17 && brew services start postgresql@17 && createdb payus`)
- [ ] Cek akses Payouts di PayPal Developer Dashboard; isi `.env.example`
      dengan `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`

### Fase 1 — 2–3 Nov · fondasi uang
- `server/db/schema.ts`: tabel `ledger_accounts`, `ledger_entries`
  (`txn_id`, `account`, `debit_minor`, `credit_minor`, `ref`, `created_at`),
  `outbox`, `webhook_events` (`event_id` unik), `split_rules`
- `server/modules/ledger/`: `post(txnId, entries[])` dalam satu transaksi
  Drizzle yang menolak jika Σdebit ≠ Σkredit; `balance(account)` dari entri
- Akun wajib ada sejak awal: `pos:<user>:<nama>`, `in_flight`,
  `platform_fee`, `tax_reserve`, `merchant_payable`, `paypal_cash`
- `server/lib/paypal.ts`: klien OAuth2 + Orders v2 (create/capture)
- `app/api/webhooks/paypal/route.ts`: verifikasi tanda tangan, simpan
  `event_id` (duplikat → 200 tanpa efek), tulis ke outbox
- Worker outbox memanggil **`invoices.reportPayment`** → inilah sambungan
  yang menyalakan ulang webhook `checkout.paid`, email, dan status checkout

**Selesai jika:** bayar checkout sandbox → invoice `paid` → webhook merchant
terkirim → entri ledger seimbang, dan mengirim ulang event yang sama tidak
menggandakan apa pun.

### Fase 2 — 4–5 Nov · split & settlement
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
- Ganti 5 placeholder dashboard dengan layar nyata; tabel transaksi pakai
  **AG Grid** (ini syarat hadiah sponsor, jadi harus terlihat di video)
- Storefront builder + pratinjau live; halaman `/pay` & `/i/<token>`
  disambung ke Orders
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
| `reportPayment` tanpa pemanggil | Fase 1 (worker outbox) |
| 5 layar dashboard placeholder | Fase 5 |
| Tidak ada UI pembuatan API key (docs/api.md menjanjikan "Developers → API keys") | Fase 5 |
| `features/embed/bridge.ts` yatim → iframe tak auto-resize & tak emit event | Fase 5 |
| 13 modul yatim (`invoicePdf`, `csv`, `download`, `PaymentQrDialog`, dll.) | dipakai di Fase 5, sisanya dihapus |
| `.gitbook.yaml` menunjuk `docs/SUMMARY.md` yang tidak ada | kapan saja |
| Test DB belum pernah dijalankan hijau | Hari 0 |

## 7. Risiko utama

1. **Akses Payouts** — mitigasi: fallback simulasi berlabel (§3)
2. **Scope 15 item P0 untuk 11 hari** — mitigasi: sisi merchant jadi hero,
   sisi pengguna cukup deposit → Allocator → Guardian
3. **IDR bukan mata uang transaksi PayPal** — demo USD, tampilan konversi
   IDR dengan kurs konstanta berlabel "informatif"
4. **Agen mengarang angka** — dicegah oleh §2.2: semua angka dari query
   ledger, LLM hanya menyusun kalimat
