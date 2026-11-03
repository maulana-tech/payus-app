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

### Fase 2 — 2–3 Nov · split & settlement
- [x] Tabel `split_rules` dan `payouts` (migrasi `0002_*.sql`)
- [x] `features/split/evaluate.ts` **murni**: persen (dari jumlah utuh, bukan
      dari sisa), nominal tetap, urutan prioritas, sisa jadi milik pemilik,
      dan pembulatan persen diselesaikan dengan **largest-remainder** — jadi
      tidak ada sen yang hilang atau tercipta. 10 test, semuanya memeriksa
      Σ alokasi === jumlah masuk lebih dulu
- [x] Settlement: `settleCapture()` memindahkan seluruh `in_flight` dalam
      satu posting, id-nya diturunkan dari capture, jadi settlement
      sebagian tidak bisa ada. Jalur cepat inline, dan kalau gagal
      diantrekan ke outbox supaya uang tidak diam di `in_flight`
- [x] Payout: `sender_batch_id = sha256(owner|amount|currency|tujuan|intentKey)`.
      **Catatan penting:** menurunkannya dari posisi ledger tidak bisa —
      posting payout itu sendiri menggeser posisinya, jadi retry terbaca
      sebagai intent baru. Sudah dicoba dan dibatalkan; `intentKey` adalah
      identitas percobaan (nonce dari dialog, nanti id usulan yang disetujui)
- [x] Fallback Payouts: tanpa `PAYPAL_PAYOUTS_ENABLED=true`, rilis dicatat
      sebagai `payout.simulated` **dengan label eksplisit di UI**, bukan
      dipura-purakan terkirim. Kalau PayPal menolak, baris `payouts`
      ditandai `failed` dan **ledger tidak disentuh sama sekali**
- [x] UI: panel "How money is divided" (dengan pratinjau memakai mesin yang
      sama persis dengan server) dan tombol "Release" di Overview
- [x] **Jalur refund — selesai 3 Nov.** Keputusannya: **membalik split
      secara proporsional**, bukan rolling reserve. Pajak yang disisihkan
      atas penjualan yang dibatalkan bukan pajak; rolling reserve menahan
      uang setiap merchant demi kejadian yang jarang. `merchant_payable`
      boleh negatif, dan itu bacaan yang jujur kalau uangnya sudah terlanjur
      ditarik. Bagiannya dibaca dari **entri ledger settlement itu sendiri**,
      bukan dihitung ulang dari aturan hari ini. Tiga kunci agar tidak
      dobel: `refund_id` PayPal, `(payment_id, intent_key)`, dan posting
      `refund:<refundId>`. Masuk lewat tombol Refund atau webhook
      `PAYMENT.CAPTURE.REFUNDED`. Invoice-nya kembali `pending`.
      6 test aritmetika + 4 test Postgres

**Terbukti oleh test:** satu pembayaran menghasilkan entri yang totalnya sama
dengan jumlah masuk (`trialBalance() === 0n` di setiap kasus), settlement
kedua tidak berefek, dan dua rilis dengan intent sama hanya menghasilkan satu
batch sementara percobaan baru yang disengaja tetap bisa.

### Fase 3 — 2–3 Nov · Guardian · **inti selesai**
- [x] `features/guardian/decide.ts` **murni**: limit per pembayaran, limit
      per hari (menghitung yang sudah keluar hari ini), dana tersedia
      menurut ledger, penerima baru butuh persetujuan, dan ambang "tanyakan
      dulu". Setiap aturan dievaluasi — bukan berhenti di yang pertama
      kena — jadi catatannya memuat semua yang salah; vonisnya yang
      terkeras, dan `reason` hanya mengutip yang menentukan
- [x] Tabel `guardian_policies`, `proposals`, `approvals`, `audit_log`
      (migrasi `0003`)
- [x] **Persetujuan terikat hash.** `approvals` adalah **log** — satu baris
      per tindakan setuju, masing-masing menyebut hash yang disetujuinya.
      `execute()` membandingkan hash persetujuan terbaru dengan hash usulan
      saat itu dan menolak kalau beda, sambil mencatat `approval.void`
- [x] Usulan kedaluwarsa: `expireStaleProposals()` dipanggil cron outbox
- [x] Audit log: usulan, siapa yang mengusulkan, model (siap diisi Fase 4),
      vonis Guardian, alasan, limit dan konteks yang dipakai saat memutuskan
- [x] Tombol "Release" pemilik **ikut lewat Guardian**, jadi jalur yang
      nanti dipakai agen sudah dipakai sehari-hari sekarang
- [x] UI: panel "Waiting for you" di Overview (dengan alasan Guardian) dan
      editor limit di Settings
- [ ] Notifikasi + persetujuan lewat **Telegram** — sesuai garis potong di
      §5, persetujuan in-app dipakai lebih dulu. Ini sisa Fase 3

**Terbukti oleh test** (19 test: 10 murni + 9 di Postgres): usulan yang
melanggar ditolak dengan alasannya tersimpan; usulan di atas ambang
menunggu dan tidak mengirim apa pun; usulan yang kedaluwarsa tidak bisa
disetujui; dan **usulan yang berubah setelah disetujui ditolak saat
dijalankan**, dengan `approval.void` masuk audit log.

### Fase 4 — 2 Nov– · agen
Urutannya kuubah dari rencana awal: **Payer lebih dulu**, bukan Developer
Agent, karena Payer langsung memakai Guardian dan ledger yang baru jadi —
jadi agen pertama bisa didemokan tanpa membangun apa pun yang baru di
bawahnya.

- [x] **Payer** — membaca buku, mengusulkan rilis, berhenti. Tidak punya
      limit sendiri sama sekali (itu urusan Guardian), tujuan wajib salah
      satu yang kita tunjukkan padanya (**diperiksa setelah parsing**, bukan
      diinstruksikan di prompt), dan bentuk jawabannya divalidasi dua kali:
      structured outputs di API, lalu zod yang memutuskan apakah aplikasi ini
      mau bertindak atasnya
- [x] `server/lib/claude.ts` — satu-satunya tempat model dipanggil. Model
      `claude-opus-5-5`, effort `low` untuk keputusan sesederhana ini,
      structured outputs (bukan forced tool use, yang ditolak 400 oleh model
      ini). Tanpa `ANTHROPIC_API_KEY` agen mati dan mengatakannya
- [x] **Eval set Payer: 11 kasus** di `test/payerAgent.test.ts`, model
      distub jadi jalan di tiap commit tanpa biaya — termasuk kasus yang
      paling penting: menolak tujuan yang dikarang, menolak nominal
      berdesimal, dan ditolak Guardian saat melebihi limit (dengan
      penolakannya tercatat atas nama agen)
- [x] **Allocator** — mengusulkan pembagian dana masuk. Ini sekaligus
      membuka Guardian jadi **multi-jenis**: `decide()` dan `execute()`
      kini memilih berdasarkan `proposal.kind`, jadi jenis ketiga nanti
      cukup menambah satu fungsi temuan dan satu fungsi penerap.
      Aturan yang hanya bisa dilihat Guardian (total share lintas aturan)
      tinggal di Guardian; batas per-aturan tinggal di skema agennya —
      dan test-nya menguji keduanya di tempat yang benar.
      Mengganti aturan **mengarsipkan** yang lama, tidak menghapusnya,
      supaya posting lama masih bisa dibaca terhadap split yang
      menghasilkannya. 10 eval + 4 test Guardian baru
- [x] **Developer Agent (storefront)** — deskripsi → konfigurasi JSON
      ber-skema → template kita → halaman di `/shop/<slug>`. Tanpa HTML
      bebas: skema yang sama mengikat editor manual **dan** agen, dan
      satu-satunya renderer meloloskan teks apa adanya (ada test-nya).
      Agen menulis **draf**; pemilik yang menerbitkan — menaruh harga di
      depan publik itu keputusan dagang, bukan keputusan model, dan itu
      pula sebabnya tidak perlu jenis usulan baru di Guardian.
      Membeli satu item menulis invoice dulu, jadi penjualan toko turun
      lewat jalur settlement yang sama.
- [x] **Toko jadi interaktif, dan batasnya ditegakkan di server.** Empat
      layout (shelf, menu, single, tip), tiga tema × enam aksen, pemilih
      jumlah, item habis, dan batas bawah/atas untuk harga yang ditentukan
      pembayar. Semua dicek ulang terhadap **item yang tersimpan**: jumlah
      dibatasi `limit` item itu sendiri, jumlah pada item yang tidak dijual
      per-satuan diabaikan, nominal pembayar harus di dalam rentang toko,
      dan `MAX_ORDER_MINOR` membatasi satu pesanan apa pun caranya. Satu
      lubang nyata ikut tertutup: sebelumnya harga-bebas menerima sampai
      $999.999.999.999. 21 test storefront + 3 render
- [x] **Satu blok HTML di toko, disanitasi di server.** Penulis (pemilik
      maupun Builder) boleh menulis prosa HTML untuk halaman tokonya, dan
      satu-satunya jalan masuk adalah `sanitizeShopHtml()` di dalam helper
      `html()` milik service — jadi tidak ada jalur tulis yang bisa
      melewatinya. Allowlist tag teks/daftar/tabel/`a`/`img`, tanpa atribut
      `style`, skema hanya `https`/`mailto`, kelas hanya `shop-*`, tautan
      dipaksa `rel="noopener noreferrer nofollow ugc"`, batas 8.000 aksara.
      Dua lapis lagi di belakangnya: render di `<iframe sandbox>` **tanpa**
      `allow-scripts`, dan view publik tidak lagi memuat `html` mentah
      (`PublicStorefrontView`) sehingga draf penulis tidak pernah
      meninggalkan server. Editor melihat pratinjau lewat
      `storefront.previewHtml` — satu sanitiser, milik server — dan daftar
      tag yang dibuang ditampilkan ke penulis. 9 test sanitiser.
- [x] **Kanvas: editor toko jadi halaman, bukan dialog.** `/canvas/[id]`
      memakai seluruh jendela — kontrol di kiri (Page, Items, HTML, Look),
      halaman tokonya sendiri di kanan, dengan lebar ponsel/tablet/penuh.
      Yang di kanan adalah `StorefrontPage`, komponen yang sama yang
      disajikan ke publik, diberi draf; jadi tidak ada renderer kedua yang
      harus dijaga seirama. Editor HTML-nya CodeMirror sungguhan (nomor
      baris, sorotan sintaks, tag menutup sendiri, bungkus baris), dimuat
      malas sehingga route lain tidak ikut membayarnya, dengan toolbar
      sisipan yang semuanya lolos sanitiser apa adanya. Halaman toko kini
      `@container` dengan breakpoint `@min-[640px]:`, sehingga pratinjau
      414px menjawab seperti ponsel sungguhan. `EditorDialog` lama dihapus.
      4 test kanvas.
- [x] **Lima toko siap pakai sebagai titik awal.** Halaman kosong adalah
      halaman terburuk di editor, jadi `/canvas/new` membuka lima draf utuh:
      Coffee bar (shelf · sun), Freelance work (single · paper), Tip jar
      (tip · ink), Warung menu (menu · paper) dan Class or event
      (single · sun) — masing-masing lengkap dengan item, harga, dan blok
      HTML. Saat memilih, kanvas menampilkan starter itu lewat
      `StorefrontPage` yang sama, jadi ia dinilai sebagai halaman yang akan
      jadi. Memilih hanya mengisi editor; sesudahnya ia draf biasa. Setiap
      starter diurai lewat `storefrontInput` di test: titik awal yang
      ditolak skema itu jebakan, bukan jalan pintas. 7 test tambahan.
- [x] **Reporter** — ringkasan dari angka ledger, dan di sinilah invarian
      §2.2 ditegakkan secara **mekanis**, bukan lewat prompt: setiap angka
      dalam jawabannya dibandingkan dengan daftar angka yang kita berikan,
      dan satu angka di luar daftar membuat laporannya dibuang — termasuk
      pengurangan yang benar, karena menghitung sendiri itu justru yang
      tidak boleh dilakukan kursi ini. UI-nya menampilkan daftar angka itu
      di bawah laporannya, karena laporan yang sumbernya tak terlihat cuma
      klaim. 6 test murni
- [ ] **Merchant Ops / Advisor** — kalau waktu sisa

### Fase 5 — 10–11 Nov · UI, hosting, laporan
- [x] **Dikerjakan lebih awal (2 Nov).** Lima placeholder dashboard diganti
      layar nyata: overview (saldo langsung dari ledger, pembayaran
      terakhir, invoice terbaru), invoices (buat + tandai lunas + void +
      stop berulang), links, requests (disegel di browser), developers
      (API key sekali tampil, webhook, log pengiriman)
- [x] **Halaman `/i/<token>` dan `/pay/...` tersambung ke Orders.** Tombol
      PayPal memanggil route kita; membayar sebuah link menulis invoice
      lebih dulu, jadi jalur settlement-nya sama persis
- [x] **Tabel transaksi pakai AG Grid** (2 Nov) — halaman `/transactions`
      berisi setiap posting ledger (kedua sisinya), bisa diurutkan,
      difilter per kolom, dicari, dipaginasi, dan diekspor CSV. Temanya
      menunjuk ke variabel `--dash-*`, jadi ikut mode terang/gelap.
      Footer-nya menjumlahkan dua kolomnya dan menyatakan "Balanced" —
      inilah yang layak muncul di video
- [x] **Storefront builder + pratinjau live** — selesai 2 Nov lewat kanvas
      `/canvas/[id]`: pratinjau adalah halaman itu sendiri, bukan tiruan.
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
| Fase 3 | ✅ sudah diambil: Guardian + tombol in-app jalan, Telegram ditunda |
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
| ~~`features/embed/bridge.ts` yatim~~ | ✅ dipasang lewat `EmbedBridge` di tiap halaman embed; `payus:paid` kini benar-benar terkirim |
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
