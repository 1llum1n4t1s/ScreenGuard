# IBM Plex Sans JP 同梱フォント

Regular / SemiBold の WOFF2 をローカル同梱し、ポップアップの CSS から読み込む。
各ファイルは既存の651コードポイントのサブセットで、未収録文字は CSS のフォールバックフォントで表示する。

- フォントの name テーブル: `Version 1.004`（IBM Plex Sans JP V1.4）
- 照合した公式リリース: [@ibm/plex-sans-jp@3.0.0](https://github.com/IBM/plex/releases/tag/%40ibm%2Fplex-sans-jp%403.0.0)
- 配布 ZIP: `ibm-plex-sans-jp.zip`
- ZIP の公開 SHA256: `4c14c41552934b0bc92fc216a76b36bdc78f745dfbeed1115f9b8bc405ee314f`
- ライセンス: [SIL Open Font License 1.1](LICENSE-IBM-Plex.txt)

2026-09-30 に公開 SHA256 と取得 ZIP を照合し、公式の `fonts/complete/woff2/unhinted/` の
Regular / SemiBold と、同梱サブセットの全651コードポイントの字形・水平メトリクスが一致することを
FontTools の `DecomposingRecordingPen` と `hmtx` で確認した。公式リリースの package version と
font version は異なるため、更新判断は実ファイルの name テーブルと字形を使う。
Dependabot の対象外なので、次回の依存更新でも公式リリースと同梱ファイルを照合する。

| ファイル | SHA256 |
| --- | --- |
| IBMPlexSansJP-Regular.woff2 | `963f9897a7c609ceced030f9b103c97514abb6d54ae8d5fc476c8bfa279e57ea` |
| IBMPlexSansJP-SemiBold.woff2 | `4980ddc789e850e9fba32115a8efe3e90d19402a231eb66cb5b169fa4679921b` |
