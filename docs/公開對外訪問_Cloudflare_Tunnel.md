# 對外開放本專案（Cloudflare Tunnel）

適用情境：專案跑在自己的 Windows / Mac 電腦上，沒有公網 IP、也不想在路由器開 port。

Cloudflare Tunnel 由本機主動對外連線，因此不需要固定 IP、不需要 NAT 轉發，且自動提供 HTTPS 憑證。

---

## 一、先完成安全設定（必做）

1. 複製 `.env.example` 為 `.env`，填入實際值。
2. 產生新的 SECRET_KEY：

   ```bash
   python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
   ```

3. `.env` 中至少確認：

   ```env
   DJANGO_DEBUG=False
   DJANGO_SECRET_KEY=<剛剛產生的值>
   DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost,ntubssae.dpdns.org
   DJANGO_CSRF_TRUSTED_ORIGINS=https://ntubssae.dpdns.org
   ```

4. `DJANGO_DEBUG=False` 之後，Django 不再自動提供靜態檔，需先收集並由 waitress/Cloudflare 前面的伺服器提供：

   ```bash
   python manage.py collectstatic --noinput
   ```

   若要讓 Django 自行提供靜態檔，可安裝並啟用 whitenoise（`settings.py` 內已有註解好的設定）：

   ```bash
   pip install whitenoise
   ```

   然後解除 `MIDDLEWARE` 中 `WhiteNoiseMiddleware` 與 `STATICFILES_STORAGE` 兩行註解。

---

## 二、安裝 cloudflared

- Windows：`winget install --id Cloudflare.cloudflared`
- macOS：`brew install cloudflared`

---

## 三、快速測試（臨時網址，免登入）

先啟動本專案：

```bash
python runserver.py     # waitress，監聽 0.0.0.0:8000
```

另開一個終端機：

```bash
cloudflared tunnel --url http://localhost:8000
```

會得到一個 `https://xxxx.trycloudflare.com` 臨時網址。測試前把該網址加進 `.env` 的
`DJANGO_ALLOWED_HOSTS` 與 `DJANGO_CSRF_TRUSTED_ORIGINS`，再重啟服務。

此網址每次重啟都會變，僅適合臨時展示。

---

## 四、正式設定（固定網域 ntubssae.dpdns.org）

前提：該網域的 nameserver 需指向 Cloudflare（在 Cloudflare 免費方案「Add a site」後，
到 dpdns.org 的管理介面把 NS 改成 Cloudflare 提供的兩組）。

```bash
cloudflared tunnel login                       # 瀏覽器授權
cloudflared tunnel create ssae                 # 建立 tunnel，會產生憑證檔
cloudflared tunnel route dns ssae ntubssae.dpdns.org
```

建立設定檔（Windows：`C:\Users\<你>\.cloudflared\config.yml`；macOS：`~/.cloudflared/config.yml`）：

```yaml
tunnel: ssae
credentials-file: C:\Users\<你>\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: ntubssae.dpdns.org
    service: http://localhost:8000
  - service: http_status:404
```

啟動：

```bash
cloudflared tunnel run ssae
```

設為開機自動執行（Windows 以系統管理員身分執行）：

```bash
cloudflared service install
```

---

## 五、Google 登入設定

外網網址改變後，Google OAuth 要同步更新：

1. `.env` 設 `GOOGLE_OAUTH2_REDIRECT_URI=https://ntubssae.dpdns.org/auth/complete/google-oauth2/`
2. Google Cloud Console → 憑證 → OAuth 用戶端 → 已授權的重新導向 URI 加入同一組網址。

---

## 六、對外開放後的檢查清單

- [ ] `DJANGO_DEBUG=False`，且 `.env` 未被提交
- [ ] `DJANGO_ALLOWED_HOSTS` 只列必要網域（不要用 `*`）
- [ ] `python manage.py check --deploy` 沒有嚴重警告
- [ ] `/admin` 帳號使用強密碼；建議在 Cloudflare Zero Trust 對 `/admin` 加上存取政策
- [ ] MySQL、MongoDB、Gmail 應用程式密碼、Azure 金鑰皆已輪替（舊值曾出現在 git 歷史中）
- [ ] 電腦休眠時服務會中斷，長期對外建議改用一台常開主機或 VPS

---

## 替代方案比較

| 方案 | 優點 | 缺點 |
| --- | --- | --- |
| Cloudflare Tunnel | 免費、自動 HTTPS、免開 port、可綁自有網域、可加存取控制 | 需把網域 NS 轉到 Cloudflare |
| ngrok | 安裝最快 | 免費版網址會變、有連線數限制 |
| 路由器 Port Forwarding + DDNS | 不依賴第三方 | 需公網 IP、需自行處理憑證與防火牆，風險最高 |
| VPS（Nginx + gunicorn） | 最穩定、正式 | 需付費與維運 |
