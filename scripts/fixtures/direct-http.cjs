// 本地回环回归必须直连。
// 若继承系统/终端代理（HTTP_PROXY 等），axios 会把请求交给代理，
// 代理再以 absolute-form 转发回测试服务器，使 req.url 变成完整 URL，
// 路径匹配（如 '/missing'）全部失效，产生与本机代理配置相关的假失败。
for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  delete process.env[name];
}
process.env.NO_PROXY = '*';
process.env.no_proxy = '*';

module.exports = true;
