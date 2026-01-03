/**
 * 快手极速版金币统计
 * 统计快手极速版多账号金币收益情况
 * cron 0 0 * * * 快手极速版金币统计.js
 * 
 * 【脚本作用】
 * - 自动获取快手极速版多账号金币收益数据
 * - 生成HTML格式的收益报表
 * - 通过青龙面板sendNotify函数发送通知
 * 
 * 【使用方法】
 * 1. 在青龙面板添加环境变量：
 *    export ksck="cookie1&cookie2"  # 多账号Cookie配置，&分隔
 * 2. 添加脚本到青龙面板，设置定时任务
 * 
 * 【通知配置】
 * - 依赖青龙面板sendNotify函数
 * - 支持多种通知方式：企业微信、PushPlus、Bark等
 * - 通知内容为HTML格式，包含账号收益详情表格
 * 
 * 【AI生成脚本】
 * - 作者：jxdyyy
 * - 仓库地址：https://github.com/jxdyyy
 */

// 引入依赖
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 配置常量
const API_ENDPOINTS = {
    BASIC_INFO: 'https://nebula.kuaishou.com/rest/n/nebula/activity/earn/overview/basicInfo?source=bottom_guide_first',
    DETAIL_INFO: 'https://nebula.kuaishou.com/rest/n/nebula/account/overview'
};

const HTTP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Redmi K30 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://nebula.kuaishou.com/',
    'Content-Type': 'application/json;charset=UTF-8'
};

// 全局变量
let notificationLog = '';

// 辅助函数

/**
 * 生成指定长度的分隔线
 * @param {number} length - 分隔线长度
 * @param {string} [char='-'] - 分隔线字符
 * @returns {string} 生成的分隔线
 */
function generateSeparator(length, char = '-') {
    return char.repeat(length);
}

/**
 * 格式化日期
 * @param {Date} date - 日期对象
 * @param {string} [format='YYYY-MM-DD'] - 格式化模板
 * @returns {string} 格式化后的日期字符串
 */
function formatDate(date, format = 'YYYY-MM-DD') {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return format
        .replace('YYYY', year)
        .replace('MM', month)
        .replace('DD', day)
        .replace('HH', hours)
        .replace('mm', minutes)
        .replace('ss', seconds);
}

/**
 * 金币转换为现金
 * @param {number} coins - 金币数量
 * @returns {string} 现金字符串
 */
function coinsToCash(coins) {
    return (coins / 10000).toFixed(2);
}

/**
 * 强制转换为数字
 * @param {*} value - 要转换的值
 * @param {number} [defaultValue=0] - 默认值
 * @returns {number} 转换后的数字
 */
function toNumber(value, defaultValue = 0) {
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
}

/**
 * 日志输出函数
 * @param {string} prefix - 日志前缀
 * @param {string} text - 日志内容
 * @param {string} [type='info'] - 日志类型
 */
function log(prefix, text, type = 'info') {
    const logPrefixes = {
        success: '[✅]',
        warning: '[⚠️]',
        error: '[❌]',
        info: '[ℹ️]',
        coin: '[🪙]',
        cash: '[💰]'
    };
    
    const prefixTag = logPrefixes[type] || logPrefixes.info;
    const logMessage = `${prefixTag} ${prefix} ${text}`;
    
    console.log(logMessage);
    notificationLog += logMessage + '\n';
}

// 获取环境变量中的Cookie列表
const rawCookies = process.env.ksck || '';
const cookieList = rawCookies.split('&').filter(cookie => cookie.trim() !== '' && cookie.length > 10);

// 校验Cookie配置
if (cookieList.length === 0) {
    const errorMsg = '❌ 未配置有效Cookie，环境变量ksck格式：cookie1&cookie2';
    console.log(errorMsg);
    notificationLog += errorMsg + '\n';
    process.exit(1);
}

// 初始化sendNotify函数
let sendNotify = null;
try {
    // 优先使用全局sendNotify函数
    if (typeof global.sendNotify === 'function') {
        sendNotify = global.sendNotify;
        log('【信息】', '已使用全局sendNotify函数', 'success');
    } else if (typeof sendNotify === 'function') {
        // 检查当前作用域是否已有sendNotify函数
        log('【信息】', '已使用当前作用域的sendNotify函数', 'success');
    } else {
        // 尝试从不同路径加载sendNotify.js
        const sendNotifyPaths = [
            './sendNotify.js',
            '../sendNotify.js',
            '/ql/sendNotify.js',
            '/ql/scripts/sendNotify.js',
            path.join(path.dirname(__filename), 'sendNotify.js'),
            path.join(path.dirname(__filename), '../sendNotify.js')
        ];
        
        let foundPath = null;
        for (const sendNotifyPath of sendNotifyPaths) {
            if (fs.existsSync(sendNotifyPath)) {
                foundPath = sendNotifyPath;
                break;
            }
        }
        
        if (foundPath) {
            // 动态加载sendNotify模块
            const sendNotifyModule = require(foundPath);
            sendNotify = typeof sendNotifyModule === 'function' 
                ? sendNotifyModule 
                : sendNotifyModule.sendNotify;
            
            log('【信息】', `已从${foundPath}引入sendNotify函数`, 'success');
        } else {
            log('【警告】', '未找到sendNotify.js文件', 'warning');
        }
    }
    
    // 确保sendNotify函数存在
    if (typeof sendNotify !== 'function') {
        sendNotify = async (title, content) => {
            log('【警告】', 'sendNotify函数未定义，跳过通知', 'warning');
        };
    }
} catch (err) {
    log('【错误】', `引入sendNotify函数失败：${err.message}`, 'error');
    
    // 定义默认sendNotify函数，防止脚本崩溃
    sendNotify = async (title, content) => {
        log('【警告】', 'sendNotify函数未定义，跳过通知', 'warning');
    };
}

/**
 * 获取用户基础信息
 * @param {string} cookie - 用户Cookie
 * @returns {Object} 用户信息和请求头
 */
async function getUserInfo(cookie) {
    const requestHeaders = { ...HTTP_HEADERS, Cookie: cookie };
    
    let userInfo = {
        nickname: '未知昵称',
        totalCash: '0元',
        totalCoin: 0,
        coinToCash: '0元 (10000金币=1元)',
        isError: false
    };
    
    try {
        const response = await axios({
            method: 'GET',
            url: API_ENDPOINTS.BASIC_INFO,
            headers: requestHeaders,
            timeout: 15000
        });
        
        if (response.data.result === 1 && response.data.data) {
            const data = response.data.data;
            
            userInfo.nickname = data.userData?.nickname || `未知账号${Math.random().toString(36).substr(2, 4)}`;
            const totalCashNum = toNumber(data.totalCash);
            userInfo.totalCash = `${totalCashNum.toFixed(2)}元`;
            userInfo.totalCoin = toNumber(data.totalCoin);
            userInfo.coinToCash = `${coinsToCash(userInfo.totalCoin)}元 (10000金币=1元)`;
        } else {
            userInfo.isError = true;
            log('【错误】', `接口返回异常：${response.data.msg || '未知错误'}`, 'error');
        }
    } catch (err) {
        userInfo.isError = true;
        log('【警告】', `获取用户信息失败：${err.message}`, 'warning');
    }
    
    return { userInfo, requestHeaders };
}

/**
 * 计算今日兑换消耗
 * @param {Array} details - 金币明细列表
 * @param {string} todayFormat - 今日日期格式
 * @returns {number} 今日兑换消耗
 */
function calculateTodayExchangeCost(details, todayFormat) {
    return details.reduce((cost, item) => {
        const itemDate = item.createTime.split(' ')[0].replace(/-/g, '.');
        return (itemDate === todayFormat && Number(item.amount) < 0) 
            ? cost + Math.abs(toNumber(item.amount)) 
            : cost;
    }, 0);
}

/**
 * 处理单个账号
 * @param {string} cookie - 用户Cookie
 * @param {number} index - 账号索引
 * @returns {Object} 处理结果
 */
async function processAccount(cookie, index) {
    const { userInfo, requestHeaders } = await getUserInfo(cookie);
    
    if (userInfo.isError) {
        log('【错误】', `账号${index + 1}处理失败：用户信息获取异常`, 'error');
        return { success: false, nickname: userInfo.nickname };
    }
    
    const accountLabel = `账号${index + 1}`;
    let currentCoin = 0;
    let todayEarnedCoins = 0;
    let cumulativeIncome = '0.00元';
    
    // 输出账号信息
    const separator = generateSeparator(40);
    console.log('\n' + separator);
    notificationLog += '\n' + separator + '\n';
    
    log('【用户】', `${accountLabel} - ${userInfo.nickname}`, 'cash');
    
    console.log(separator);
    notificationLog += separator + '\n';
    
    // 输出基础收益信息
    log('【信息】', '基础收益信息');
    log('【现金】', `总现金：${userInfo.totalCash}`, 'cash');
    log('【金币】', `总金币：${userInfo.totalCoin}`, 'coin');
    log('【金币】', `金币换算现金：${userInfo.coinToCash}`, 'coin');
    
    try {
        // 获取收益明细
        const detailResponse = await axios({
            method: 'GET',
            url: API_ENDPOINTS.DETAIL_INFO,
            headers: requestHeaders,
            timeout: 15000
        });
        
        if (detailResponse.data.result !== 1 || !detailResponse.data.data) {
            throw new Error('获取明细失败');
        }
        
        const detailData = detailResponse.data.data;
        currentCoin = toNumber(detailData.coinBalance, userInfo.totalCoin);
        const cumulativeIncomeNum = toNumber(detailData.accumulativeAmount);
        cumulativeIncome = `${cumulativeIncomeNum.toFixed(2)}元`;
        
        const coinDetails = detailData.coinAccountPage?.data || [];
        const todayFormat = new Date().toISOString().split('T')[0].replace(/-/g, '.');
        const todayExchangeCost = calculateTodayExchangeCost(coinDetails, todayFormat);
        
        // 输出累计收益
        log('【成功】', `累计收益：${cumulativeIncome}`, 'success');
        console.log();
        notificationLog += '\n';
        
        // 计算今日收益
        const balanceDifference = currentCoin + todayExchangeCost;
        todayEarnedCoins = Math.max(balanceDifference, 0);
        
        // 输出今日明细
        const todayDetails = coinDetails.filter(item => {
            return item.createTime.split(' ')[0].replace(/-/g, '.') === todayFormat;
        });
        
        if (todayDetails.length > 0) {
            log('【信息】', `今日金币明细（共${todayDetails.length}条）`);
            
            // 只显示前10条明细
            const displayDetails = todayDetails.slice(0, 10);
            displayDetails.forEach((item, idx) => {
                const amount = toNumber(item.amount);
                const detailLog = `   ├─ ${idx + 1}. ${item.eventType}：${amount > 0 ? '+' : ''}${amount}金币`;
                console.log(detailLog);
                notificationLog += detailLog + '\n';
            });
            
            // 显示省略提示
            if (todayDetails.length > 10) {
                const omittedLog = `   └─ 还有${todayDetails.length - 10}条明细，已省略`;
                console.log(omittedLog);
                notificationLog += omittedLog + '\n';
            }
        }
        
    } catch (err) {
        log('【错误】', `${accountLabel}处理异常：${err.message}`, 'error');
    }
    
    // 输出账号处理结束
    console.log('\n' + separator);
    notificationLog += '\n' + separator + '\n';
    
    return {
        success: true,
        nickname: userInfo.nickname,
        accountDisplay: accountLabel,
        finalEarnedCoin: todayEarnedCoins,
        currentCoin,
        totalCash: userInfo.totalCash,
        cumulativeIncome
    };
}

/**
 * 生成HTML格式的推送内容
 * @param {Array} results - 账号处理结果列表
 * @param {number} totalEarnedCoins - 总收益金币
 * @param {number} totalCurrentCoins - 总当前金币
 * @returns {string} HTML内容
 */
function generateHtmlContent(results, totalEarnedCoins, totalCurrentCoins) {
    const now = new Date();
    const dateStr = formatDate(now, 'YYYY-MM-DD');
    
    let content = `<div style="width: 100%; max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">`;
    
    // 紫色渐变标题栏
    content += `<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px; text-align: center;">`;
    content += `<h2 style="margin: 0; font-size: 18px;">快手多账号收益报告</h2>`;
    content += `<p style="margin: 10px 0 0; font-size: 14px;">日期：${dateStr}</p>`;
    content += `</div>`;
    
    // 账号信息卡片
    results.forEach(result => {
        if (result.success) {
            content += `<div style="background: white; margin: 15px 0; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">`;
            content += `<h3 style="margin: 0 0 15px; font-size: 16px; color: #333;">${result.accountDisplay} · ${result.nickname}</h3>`;
            
            // 收益数据行
            content += `<div style="margin: 10px 0;">`;
            content += `<span style="display: inline-block; width: 120px; color: #666;">总现金：</span>`;
            content += `<span style="color: red; font-weight: bold;">${result.totalCash}</span>`;
            content += `</div>`;
            
            content += `<div style="margin: 10px 0;">`;
            content += `<span style="display: inline-block; width: 120px; color: #666;">总金币：</span>`;
            content += `<span>${result.currentCoin}枚</span>`;
            const coinToCash = coinsToCash(result.currentCoin);
            content += `<span style="margin-left: 10px; color: #666;">(${coinToCash}元)</span>`;
            content += `</div>`;
            
            content += `<div style="margin: 10px 0;">`;
            content += `<span style="display: inline-block; width: 120px; color: #666;">累计收益：</span>`;
            content += `<span style="color: red; font-weight: bold;">${result.cumulativeIncome}</span>`;
            content += `</div>`;
            
            content += `</div>`;
        }
    });
    
    content += `</div>`;
    
    return content;
}

/**
 * 主函数
 */
async function main() {
    // 输出启动信息
    const separator = generateSeparator(50);
    console.log('\n' + separator);
    notificationLog += '\n' + separator + '\n';
    
    const startTime = new Date().toLocaleString();
    log('【信息】', `快手当日金币收益记录启动 - ${startTime}`);
    
    console.log(separator + '\n');
    notificationLog += separator + '\n';
    
    // 输出Cookie检测结果
    if (cookieList.length === 1) {
        log('【警告】', `仅检测到1个有效Cookie，如需多账号请用&分隔配置\n`);
    } else {
        log('【信息】', `检测到${cookieList.length}个有效Cookie\n`);
    }
    
    // 处理所有账号
    const results = [];
    for (let i = 0; i < cookieList.length; i++) {
        const result = await processAccount(cookieList[i], i);
        results.push(result);
    }
    
    // 输出执行结果
    console.log('\n' + separator);
    notificationLog += '\n' + separator + '\n';
    
    log('【成功】', `当日金币收益记录执行完毕（共处理${cookieList.length}个账号）`, 'success');
    
    console.log(separator + '\n');
    notificationLog += separator + '\n';
    
    // 计算总收益
    const totalEarnedCoins = results.reduce((sum, result) => {
        return result.success ? sum + result.finalEarnedCoin : sum;
    }, 0);
    
    const totalCurrentCoins = results.reduce((sum, result) => {
        return result.success ? sum + result.currentCoin : sum;
    }, 0);
    
    // 生成推送内容
    const htmlContent = generateHtmlContent(results, totalEarnedCoins, totalCurrentCoins);
    
    // 发送通知
    await sendNotify('快手收益记录', htmlContent);
}

// 启动脚本
const scriptStartTime = Date.now();
main().catch(err => {
    const separator = generateSeparator(50);
    
    console.log('\n' + separator);
    notificationLog += '\n' + separator + '\n';
    
    log('【错误】', `脚本执行出错：${err.message}`, 'error');
    
    console.log(separator + '\n');
    notificationLog += separator + '\n';
    
    // 发送错误通知
    sendNotify('脚本异常', notificationLog).catch();
});
