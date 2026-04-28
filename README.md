# 3語で整える Netlify版

ふと選んだ3語から、今日の気づきと「感謝・改善・目標」の3行日記を作るWebアプリです。

## ファイル構成

```text
3go-de-totonou-netlify/
├─ index.html
├─ netlify/
│  └─ functions/
│     └─ generate.js
├─ netlify.toml
├─ package.json
├─ .env.example
├─ .gitignore
└─ README.md
```

## Netlifyで公開する手順

### 1. GitHubにアップロード

このフォルダの中身をGitHubリポジトリにアップします。

リポジトリ名の例：

```text
3go-de-totonou
```

### 2. Netlifyにログイン

Netlifyにログインします。

### 3. Add new site

Netlifyで次の順番に進みます。

```text
Add new site
↓
Import an existing project
↓
GitHub
↓
3go-de-totonou を選択
```

### 4. Build settings

基本は `netlify.toml` があるので、そのままでOKです。

必要なら以下のようにします。

```text
Build command：空欄
Publish directory：.
Functions directory：netlify/functions
```

### 5. 環境変数を設定

Netlifyのサイト設定で、以下を追加します。

```text
OPENAI_API_KEY = あなたのOpenAI APIキー
OPENAI_MODEL = gpt-4.1-mini
```

場所の目安：

```text
Site configuration
↓
Environment variables
```

### 6. Deploy

Deployします。

公開URLを開いて、3語を入力し「今日の気づきを作る」を押すとAI生成されます。

## 大事な注意

APIキーは `index.html` やGitHubに直接書かないでください。  
必ずNetlifyのEnvironment variablesに設定してください。
