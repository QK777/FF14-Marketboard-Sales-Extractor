# FF14-Marketboard-Sales-Extractor
FF14のログ（チャットログ / ACTログ）から **「マーケットで売れた」売却ログだけ**を抽出し、  
売れたアイテム名をリスト化して **クリックでコピー**できるWebアプリです。

## 🌐 公開ページ（GitHub Pages）
▶ **https://qk777.github.io/FF14-Marketboard-Sales-Extractor/**  

---


- ✅ 売却ログのみ抽出します。（日本語に限ります）
- ✅ FF14のログを複数行まとめてコピペで抽出できます。
- ✅ Advanced Combat TrackerのLogを監視し自動で抽出できます。
- ✅ 抽出結果はリストに追加されます。
- ✅ 重複ログは弾きます。
- ✅ 同じアイテムはまとめて `(xN)` 表示します。（任意で変更可）
- ✅ 並び替えが出来ます。（昇順 / 降順）
- ✅ 個別削除 / 全消去ができます。
- ✅ LocalStorage に保存（ブラウザに残る）します。

---

## スクリーンショット
![Demo](docs/screenshot02.png)

### ✅ 抽出対象（売却ログ）手動貼り付けの場合
例：
トライヨラマーケットに178,314ギルで出品したコートリーラヴァー・キャスターリストレットが売れ、172,965ギルを入手しました。

## License
MIT

## 開発 / カスタマイズ
SALE_MSG_RE（正規表現）を編集することで抽出条件を変更できます。
UIは style.css で調整可能です。

## Credits
FINAL FANTASY XIV © SQUARE ENIX
# FF14-Marketboard-Sales-Extractor
