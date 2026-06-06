# 设置 GitHub 的 HTTP 代理
git config --global http.https://github.com.proxy http://127.0.0.1:7897

# 设置 GitHub 的 HTTPS 代理
git config --global https.https://github.com.proxy http://127.0.0.1:7897

# 取消代理
git config --global --unset http.https://github.com.proxy
git config --global --unset https.https://github.com.proxy