# よていくん デプロイ手順

## 必要なもの
- Node.js（インストール済みであること）
- Firebaseアカウント（設定済み）

## 手順

### 1. Firebase CLIをインストール
```bash
npm install -g firebase-tools
```

### 2. Firebaseにログイン
```bash
firebase login
```
ブラウザが開くのでGoogleアカウントでログイン。

### 3. Firestoreのセキュリティルールを設定
Firebase Console → Firestore Database → ルール に以下を貼り付けて公開：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /events/{eventId} {
      allow read: if true;
      allow create: if true;
      allow update: if true;
    }
  }
}
```

### 4. デプロイ
このREADME.mdと同じフォルダで：

```bash
firebase deploy --only hosting:yotei-kun
```

### 5. 完了！
デプロイ後に表示されるURLにアクセスすれば使えます。
例: https://yotei-kun-6f3c9.web.app


  対応した修正一覧                                                                                                                    
                                                                                                                                      
  1. デモデータ                                                                                                                       
                                                                                                                                      
  コード上はすでに answers: []
  で作成していたため問題なし。既存のFirestoreドキュメント（あき・たかし）はFirebaseコンソールから手動削除してください。

  2. リアルタイム更新

  - window.S = S を追加し、HTMLの onclick="navigateTo('answer', S.id)" が正しく動くよう修正（モジュールスコープのバグ修正）
  - onSnapshot で S.closed も更新するよう拡張

  3. 同名ユーザー問題

  - localStorage の UID で回答を管理。同名の別人も独立して回答できる
  - 提出時に同名の別UID回答が存在する場合、確認ダイアログを表示

  4. Cookie → localStorage UID

  - getOrCreateUid() で永続的なUID管理。同一ブラウザでは確実に回答済み制限が効く
  - シークレットモード・別ブラウザは防げない点は変わらず（認証なしの限界）

  5. 締め切り機能（新機能）

  - イベント作成時に creatorToken を localStorage に保存
  - 結果画面で作成者のみ「回答を締め切る」ボタンを表示
  - 締め切り後は回答画面に「受付終了」バナーを表示、結果画面に「締め切り済み」バッジ表示

  6. タッチドラッグ改善

  - cell._k → cell.dataset.k に変更（elementFromPoint 後も確実に参照可能）
  - touchmove で DOM を遡って data-k を持つ要素を検索
  - CSS に touch-action: none と user-select: none を追加

  7. Firestoreセキュリティルール

  firestore.rules ファイルを新規作成。Firebase コンソール → Firestore → ルール から貼り付けてください。主な制約：
  - answers と closed フィールドのみ更新可能
  - closed は true への一方向のみ（戻せない）
  - 回答数の上限（200件）