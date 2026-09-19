// ==UserScript==
// @name         东华大学本科教务管理系统选课显示增强
// @namespace    http://tampermonkey.net/
// @version      3.10
// @description  1. 培养计划页面追加教学大纲/教学日历按钮，班次列表统一由课程名称进入 2. 选课手册显示最新版本(2019-2026级) 3. 已修/已选/已通过课程可查看班次列表 4. 移除首页浮动的评教指南 5. “全校”选项可汇总显示所有开课部门的课程 6. 兼容校外 webproxy 代理访问 7. 简化文化素质类课程数量提示 8. 已选课程支持在班次列表内直接换课 9. 培养计划页面可展开查看不计入总学分的其它课程 10. 培养计划页面的“已选”可点击退课 11. 培养计划页面底部追加超星学习通自选课程入口 12. 教学大纲/教学日历无内容时给出占位提示 13. 教学大纲/教学日历弹窗内可下载为 Word 文档 14. 选课页面左上角追加可展开的课程表侧边栏，课表下方列出未设置上课时间的课程 15. 志愿型选课模式下，退课按钮同时支持撤销志愿课程 16. 培养计划页面的“未读”课程若本次可选，在当前选课学期列标记“可选”
// @author       NullWinters
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toSH*
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toSCC*
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toSelectByOrgn*
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toOEC*
// @match        https://jwgl.dhu.edu.cn/dhu/studenthome.jsp*
// @include      /^https:\/\/(?:webproxy|webvpn)\.dhu\.edu\.cn\/(?:https\/[^\/]+\/)?dhu\/(?:selectcourse\/(?:toSH|toSCC|toSelectByOrgn|toOEC)|studenthome\.jsp)/
// @grant        GM_xmlhttpRequest
// @connect      jw.dhu.edu.cn
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // 校外通过教务代理访问时，URL 形如 https://webproxy.dhu.edu.cn/https/<token>/dhu/xxx，
    // 其中 <token> 是代理对目标站点加密后的标识，代理还会注入 vpn_rewrite_url 用于改写站外地址。
    // 以地址中的 /https/ 前缀为主要判据，避免代理脚本晚于本脚本注入时误判为直连
    function isProxied() {
        return window.location.pathname.startsWith('/https/')
            || typeof pageWindow.vpn_rewrite_url === 'function';
    }

    // 取站点内路径，即去掉代理的 /https/<token> 前缀，便于与直连环境使用同一套判断
    function sitePath() {
        const matched = window.location.pathname.match(/^(?:\/https\/[^/]+)?(\/dhu\/.*)$/);
        return matched ? matched[1] : window.location.pathname;
    }

    // 代理环境下需调用页面内的 fetch：代理脚本会把站外地址改写为同源代理地址，不受跨域限制；
    // 脚本沙箱中的 fetch 不会被改写，直连环境则使用 GM_xmlhttpRequest 绕过跨域
    function fetchExternalText(url, onload, onerror) {
        if (isProxied()) {
            pageWindow.fetch(url).then(response => response.text()).then(onload).catch(onerror);
        } else {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: response => onload(response.responseText),
                onerror: onerror
            });
        }
    }

    // 代理环境下站外链接无法直连，需改写为代理地址后才能访问；
    // 代理会给链接地址挂双向改写钩子（写入代理地址会被还原为原始地址、点击时再改写），
    // 此处改写与直接写入原始地址等价，用于兜底代理脚本尚未注入的时刻
    function toAccessibleUrl(url) {
        if (!isProxied()) return url;
        try {
            return pageWindow.vpn_rewrite_url(url);
        } catch (e) {
            return url;
        }
    }

    // 等待页面加载完成
    function waitForElement(selector, callback) {
        if (document.querySelector(selector)) {
            callback();
        } else {
            setTimeout(() => waitForElement(selector, callback), 100);
        }
    }

    // 添加模态框
    function addModal() {
        if (document.getElementById('onlineView')) return;

        const modalHTML = `
        <div id="onlineView" class="modal hide fade" tabindex="-1" data-focus-on="input:first" keyboard="true"
             style="width: 80%; max-height: 700px; margin-left: -498px; display: none;" aria-hidden="true">
            <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal" aria-hidden="true"></button>
                <h3>在线预览</h3>
            </div>
            <div class="modal-body" style="font-size:14px;max-height: 500px;!important;">
                <div class="modal-body content" style="font-size:14px;height: 400px;margin-bottom:0;"></div>
            </div>
            <div class="modal-footer">
                <button type="button" id="materialDownloadBtn" class="btn green" style="display: none;">下载为 Word 文档</button>
                <button type="button" data-dismiss="modal" class="btn">取消</button>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    // 定义 showCourseProp 函数
    function defineShowCourseProp() {
        if (typeof pageWindow.showCourseProp !== 'function') {
            pageWindow.showCourseProp = function (courseCode, type) {
                $.viewCourseMaterial({
                    courseCode: courseCode,
                    type: type,
                    tagId: 'onlineView',
                    contextPath: '/dhu'
                });
            };
        }
    }

    // 课程材料弹窗中 .content 与类型编号的对应关系，与页面 comment 里“课程大纲、教学日历、教学概述”一致
    const MATERIAL_TYPE_NAMES = { 1: '教学大纲', 2: '教学日历', 3: '教学概述' };

    // 查不到材料时弹窗内容为空，这里补一段占位提示；
    // 服务端还会给出失败原因（如 [ERR-998]-其他异常），作为次要信息一并显示
    function renderMaterialPlaceholder($content, type, message) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'padding-top:150px;text-align:center;font-size:14px;color:#999;';

        const main = document.createElement('div');
        main.textContent = '该课程暂未提供' + (MATERIAL_TYPE_NAMES[type] || '课程材料');
        wrapper.appendChild(main);

        if (message) {
            const hint = document.createElement('div');
            hint.style.cssText = 'margin-top:12px;font-size:12px;color:#ccc;';
            hint.textContent = '教务系统返回：' + message;
            wrapper.appendChild(hint);
        }

        $content.empty().append(wrapper);
    }

    // 弹窗底部的下载按钮，只有当前这门课确实取到材料时才显示
    const MATERIAL_DOWNLOAD_BUTTON_ID = 'materialDownloadBtn';
    // 当前弹窗里的材料，供下载按钮取用；没有材料时置空，按钮随之隐藏
    let currentMaterial = null;

    // 从课程表格里反查课程名称，用于生成文件名。
    // 培养计划页会把课程代码挂在课程名称链接的 data-course-code 上，优先取它；
    // 各院系开课情况页只有裸表格，按“课程代码所在行的相邻单元格”推断
    function findCourseName(courseCode) {
        const code = String(courseCode || '');
        if (!code) return '';

        const linked = document.querySelector('[data-course-code="' + code + '"]');
        if (linked) {
            const name = linked.textContent.trim();
            if (name) return name;
        }

        const isNumber = text => /^[\d.\s]+$/.test(text);
        for (const row of document.querySelectorAll('table tbody tr')) {
            // 弹窗里的材料本身也是表格，同样可能出现课程代码，不能从这里取名称
            if (row.closest('#onlineView')) continue;

            const cells = Array.from(row.querySelectorAll('td'));
            const index = cells.findIndex(cell => cell.textContent.trim() === code);
            if (index < 0) continue;

            // 培养计划页是 课程类别/课程编号/课程名称，名称在编号之后；
            // 开课情况页是 课程名称/课程编号/学分，编号之后是纯数字的学分，需要往前找
            if (index >= 1 && cells[index + 1]) {
                const after = cells[index + 1].textContent.trim();
                if (after && !isNumber(after)) return after;
            }
            for (let i = index - 1; i >= 0; i--) {
                const text = cells[i].textContent.trim();
                if (text && !isNumber(text)) return text;
            }
        }
        return '';
    }

    // 去掉文件名里的非法字符，避免下载时被浏览器或系统拒绝
    function sanitizeFileName(text) {
        return String(text || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
    }

    function materialFileName(courseCode, type) {
        return [findCourseName(courseCode), MATERIAL_TYPE_NAMES[type] || '课程材料', courseCode]
            .map(sanitizeFileName)
            .filter(part => part !== '')
            .join('_') + '.doc';
    }

    // 材料是服务端由 Office 文档转换出的完整 HTML 文档，另存为 .doc 后 Word/WPS 会按文档打开并保留排版。
    // 但转换结果里带着三类脏数据，原样落盘会出问题：
    // 1. Word 系列声明的 charset 是 gb2312，而字节实际是 UTF-8，保存后打开就是乱码；
    // 2. <link> 指向 xxx.files/filelist.xml 等 Word 元数据，服务端并不存在；
    // 3. <img> 全部指向服务端没有的路径（/data/program/... 实测 404），Word 里会显示成红叉。
    function buildMaterialDocFile(material, title) {
        const doc = new DOMParser().parseFromString(String(material), 'text/html');

        doc.querySelectorAll('link').forEach(node => node.remove());
        doc.querySelectorAll('meta').forEach(node => {
            const equiv = node.getAttribute('http-equiv') || '';
            if (node.hasAttribute('charset') || /content-type/i.test(equiv)) node.remove();
        });

        doc.querySelectorAll('img').forEach(img => {
            if (/^data:/i.test(img.getAttribute('src') || '')) return;
            const placeholder = doc.createElement('span');
            placeholder.textContent = '【图片缺失】';
            placeholder.setAttribute('style', 'color:#999;');
            img.replaceWith(placeholder);
        });

        // 声明放在 head 最前，同时补上 UTF-8 BOM，
        // Word 判定本地 HTML 的编码以 BOM 为准，两者都给上可避免声明与字节不一致
        const meta = doc.createElement('meta');
        meta.setAttribute('charset', 'utf-8');
        doc.head.insertBefore(meta, doc.head.firstChild);
        doc.title = title;

        return '\ufeff<!DOCTYPE html>\r\n' + doc.documentElement.outerHTML;
    }

    // 弹窗由页面自带（#onlineView 已在 HTML 里）时 addModal() 会直接返回，不会带上下载按钮，
    // 所以这里按需把按钮补进弹窗底部，两种情况都能用；绑定也放在这里，避免按钮晚于初始化创建时漏绑
    function ensureMaterialDownloadButton() {
        const existing = document.getElementById(MATERIAL_DOWNLOAD_BUTTON_ID);
        if (existing) {
            if (existing.dataset.enhanced !== 'true') {
                existing.dataset.enhanced = 'true';
                existing.addEventListener('click', downloadMaterialDoc);
            }
            return existing;
        }

        const footer = document.querySelector('#onlineView .modal-footer');
        if (!footer) return null;

        const button = document.createElement('button');
        button.type = 'button';
        button.id = MATERIAL_DOWNLOAD_BUTTON_ID;
        button.className = 'btn green';
        button.textContent = '下载为 Word 文档';
        button.style.display = 'none';
        footer.insertBefore(button, footer.firstChild);
        return ensureMaterialDownloadButton();
    }

    function updateMaterialDownloadButton() {
        const button = ensureMaterialDownloadButton();
        if (!button) return;
        button.style.display = currentMaterial ? '' : 'none';
    }

    function downloadMaterialDoc() {
        if (!currentMaterial) return;

        const blob = new Blob([buildMaterialDocFile(currentMaterial.html, currentMaterial.title)],
            { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = currentMaterial.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    function enhanceMaterialDownload() {
        if (ensureMaterialDownloadButton()) return;
        // 个别页面晚于本轮初始化才渲染弹窗，等它出现再补按钮
        waitForElement('#onlineView .modal-footer', ensureMaterialDownloadButton);
    }

    // 增强 $.viewCourseMaterial：原实现只在拿到材料时才写入内容，且没有清空与失败提示。
    // 课程没有上传材料时后端返回的是 [{"msg":"[ERR-998]-其他异常","success":false}]，
    // 结果被包在数组里，result.success 取到 undefined，!result.success 成立，
    // 于是执行 $("#tagId .content").html(result.msg)，而 .html(undefined) 是空操作，
    // 弹窗要么显示空白，要么残留上一门课程的材料。
    // 这里改为请求前先清空内容，拿不到材料时给出占位提示，各类入口（页面自带的
    // showCourseProp、培养计划页与班次列表里追加的链接）都经过该函数，无需逐个改动
    function enhanceViewCourseMaterial() {
        if (!$.viewCourseMaterial || $.viewCourseMaterial.enhanced) return;

        $.viewCourseMaterial = function (options) {
            const tagId = options.tagId;
            const type = options.type ? options.type : 1;
            const $modal = $('#' + tagId);
            const $content = $('#' + tagId + ' .content');

            const showModal = () => {
                const modalWidth = $modal.width();
                $modal.modal('show').css({ 'margin-left': '-' + parseInt(modalWidth) / 2 + 'px' });
            };

            // 上一次的材料先清空，否则查询失败时弹窗会残留上一门课程的内容
            $content.empty();

            $.ajax({
                url: options.contextPath + '/course/onlineViewNewBySftp',
                type: 'POST',
                dataType: 'json',
                data: { courseCode: options.courseCode, type: type },
                success: function (result) {
                    // 结果被包了一层数组即为失败，取不到 content 时同样按失败处理
                    const material = (result && !Array.isArray(result) && result.success) ? result.content : '';
                    if (material && String(material).trim() !== '') {
                        $content.html(material);
                        currentMaterial = {
                            html: material,
                            title: [findCourseName(options.courseCode),
                            MATERIAL_TYPE_NAMES[type] || '课程材料',
                            options.courseCode].filter(part => part).join(' '),
                            fileName: materialFileName(options.courseCode, type)
                        };
                    } else {
                        currentMaterial = null;
                        renderMaterialPlaceholder($content, type,
                            (result && !Array.isArray(result) && result.msg) || '');
                    }
                    updateMaterialDownloadButton();
                    showModal();
                },
                error: function () {
                    currentMaterial = null;
                    updateMaterialDownloadButton();
                    renderMaterialPlaceholder($content, type, '');
                    showModal();
                }
            });
        };

        $.viewCourseMaterial.enhanced = true;
    }

    // 培养计划页面的课程表格：#tsCoursesTbl，课程行为
    // 课程类别 / 课程编号 / 课程名称 / 学分 / 8 个学期列，共 12 列
    const PLAN_TABLE_ID = 'tsCoursesTbl';
    const PLAN_TABLE_COLUMNS = 12;
    // 在“课程名称”列后追加的两列，type 与 pageWindow.showCourseProp(courseCode, type) 对应
    const PLAN_ACTION_COLUMNS = [
        { title: '教学大纲', type: 1 },
        { title: '教学日历', type: 2 }
    ];
    // 已选课程在学期列里只有一个“已选”标记，这里换成可直接退课的入口
    const PLAN_ENROLLED_MARK = '已选';
    const PLAN_DROP_TEXT = '退课';

    // 班次列表弹窗中的班次表格，各选课页面共用同一个 id
    const CLASS_LIST_TABLE_ID = 'accessClassTbl';

    // 表格总列数：带跨行表头的单元格按 colspan 计入，最后一行表头单元格均为单列
    function planTableColumnCount(table) {
        const headerRows = table.querySelectorAll('thead tr');
        if (headerRows.length === 0) return PLAN_TABLE_COLUMNS;

        let count = 0;
        headerRows.forEach(row => {
            Array.from(row.children).forEach(cell => {
                if (cell.rowSpan === headerRows.length) count += cell.colSpan;
            });
        });
        return count + headerRows[headerRows.length - 1].children.length;
    }

    // 分类标题行与占位行依靠 colspan 占满整行，追加两列后原 colspan 会短两格。
    // 表格内容会被 selecthome.js 重新渲染，且渲染顺序不固定（占位行可能在课程行之后才插入），
    // 因此这里每次都按表头实际列数校正，不能只在首次处理课程行时顺带执行
    function syncPlanRowColspans(table) {
        const columnCount = planTableColumnCount(table);

        table.querySelectorAll('tbody tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length === 0 || cells.length >= columnCount) return;

            const lastCell = cells[cells.length - 1];
            if (!lastCell.hasAttribute('colspan')) return;

            const colSpan = columnCount - cells.length + 1;
            if (lastCell.colSpan !== colSpan) lastCell.colSpan = colSpan;
        });
    }

    // 表头由服务端渲染一次，追加两列的同时收窄课程名称与学期列，保持总宽度仍为 100%
    function enhancePlanTableHeader(table) {
        const headerRow = table.querySelector('thead tr');
        if (!headerRow || headerRow.dataset.planHeaderEnhanced === 'true') return;

        const nameHeader = Array.from(headerRow.children).find(th => th.textContent.trim() === '课程名称');
        if (!nameHeader) return;

        headerRow.dataset.planHeaderEnhanced = 'true';
        nameHeader.style.width = '25%';
        table.querySelectorAll('thead tr#yeartermPart th').forEach(th => {
            th.style.width = '4.5%';
        });

        let previous = nameHeader;
        PLAN_ACTION_COLUMNS.forEach(column => {
            const th = document.createElement('th');
            th.rowSpan = 2;
            th.style.width = '7%';
            th.textContent = column.title;
            previous.parentNode.insertBefore(th, previous.nextSibling);
            previous = th;
        });
    }

    // 课程编号不再承担班次列表入口，仅作普通黑色文本；班次列表统一改由课程名称打开
    function enhancePlanCourseRow(cells, courseCode, courseName) {
        const codeCell = cells[1];
        codeCell.textContent = courseCode;
        codeCell.style.color = '#000';

        const nameCell = cells[2];
        nameCell.textContent = '';
        const nameLink = document.createElement('a');
        nameLink.textContent = courseName;
        // selectScope 依赖链接自身取课程代码，这里直接把代码挂在链接上
        nameLink.dataset.courseCode = courseCode;
        nameLink.title = '点击查看班次列表';
        nameLink.style.cursor = 'pointer';
        nameLink.style.color = '#0066cc';
        nameLink.style.textDecoration = 'none';
        nameLink.addEventListener('click', () => pageWindow.selectScope(nameLink));
        nameCell.appendChild(nameLink);

        let previous = nameCell;
        PLAN_ACTION_COLUMNS.forEach(column => {
            const cell = document.createElement('td');
            const link = document.createElement('a');
            link.textContent = column.title;
            link.addEventListener('click', () => pageWindow.showCourseProp(courseCode, column.type));
            cell.appendChild(link);
            previous.parentNode.insertBefore(cell, previous.nextSibling);
            previous = cell;
        });
    }

    // 已选课程所在学期列显示“已选”，改为可点击的“退课”。
    // 只按单元格文本判断，不依赖列结构，因此追加的两列以及“其它课程”行都不会有影响；
    // 替换后单元格文本变为“退课”，重复执行不会叠加链接
    function enhanceEnrolledMarks(table) {
        table.querySelectorAll('tbody tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            // 课程编号、课程名称固定在分类列之后，与是否已追加操作列无关
            if (cells.length < 3) return;

            const courseCode = cells[1].textContent.trim();
            const courseName = cells[2].textContent.trim();
            if (!/^\d+$/.test(courseCode) || !courseName) return;

            Array.from(cells).forEach(cell => {
                if (cell.textContent.trim() !== PLAN_ENROLLED_MARK) return;

                cell.textContent = '';
                const link = document.createElement('a');
                link.textContent = PLAN_DROP_TEXT;
                link.title = '点击退掉该课程';
                link.style.cursor = 'pointer';
                link.style.color = '#0066cc';
                link.style.textDecoration = 'none';
                link.addEventListener('click', () => dropEnrolledCourse(courseCode, courseName, link));
                cell.appendChild(link);
            });
        });
    }

    // 表格里标着“未读”的课程还没修读，其中一部分本次选课就开放。
    // 当前选课学期所在列由服务端以上底色（#eaf1f1）标出，列位置会随表格列数变化
    // （本脚本追加的教学大纲、教学日历两列也会影响），因此运行时从数据行探测，不写死列号
    const CURRENT_TERM_TINT = 'eaf1f1';
    const PLAN_UNREAD_MARK = '未读';
    const PLAN_SELECTABLE_MARK = '可选';

    // accessJudge 的判定只取决于课程与当前选课轮次，同一课程不必重复查询
    const courseAccessCache = new Map();

    // 带底色单元格出现次数最多的那一列即当前选课学期列。
    // 分类标题行、其它课程行都不含底色，不影响统计
    function currentTermColumnIndex(table) {
        const counts = new Map();
        Array.from(table.tBodies).forEach(tbody => {
            Array.from(tbody.rows).forEach(row => {
                Array.from(row.cells).forEach(cell => {
                    if ((cell.getAttribute('style') || '').indexOf(CURRENT_TERM_TINT) === -1) return;
                    counts.set(cell.cellIndex, (counts.get(cell.cellIndex) || 0) + 1);
                });
            });
        });

        let columnIndex = -1;
        let maxCount = 0;
        counts.forEach((count, cellIndex) => {
            if (count <= maxCount) return;
            maxCount = count;
            columnIndex = cellIndex;
        });
        return columnIndex;
    }

    // 课程本次是否开放选课：accessJudge 返回 success 即为开放，
    // 不开放时接口会给出原因（如“该课程没有开放选课”）
    function queryCourseAccess(courseCode) {
        const cached = courseAccessCache.get(courseCode);
        if (cached !== undefined) return Promise.resolve(cached);

        return new Promise(resolve => {
            $.ajax({
                url: pageWindow.contextPath + '/selectcourse/accessJudge',
                type: 'POST',
                dataType: 'json',
                data: { courseCode: courseCode },
                success: result => {
                    const selectable = !!(result && result.success);
                    courseAccessCache.set(courseCode, selectable);
                    resolve(selectable);
                },
                // 查询失败按不可选处理并保留“未读”，宁可漏标也不要误标
                error: () => resolve(false)
            });
        });
    }

    // 未读课程若本次可选，就把标记挪到当前选课学期列显示为“可选”，并清掉原来学期列的“未读”。
    // “未读”标示的是计划修读的学期，与本次能否选课无关，选中后由当前学期的标记来提示，
    // 因此只清空单元格文本而不删除单元格，避免后面的列整体左移
    function enhanceUnreadCourses(table) {
        const termColumn = currentTermColumnIndex(table);
        if (termColumn < 0) return;

        Array.from(table.tBodies).forEach(tbody => {
            Array.from(tbody.rows).forEach(row => {
                // 表格内容会被 selecthome.js 重新渲染，新行没有标记，因此每次都要重新判断；
                // 查询结果有缓存，重复处理不会产生额外请求
                if (row.dataset.planAccessEnhanced === 'true') return;

                const cells = Array.from(row.cells);
                if (cells.length < 3) return;

                const unreadCell = cells.find(cell => cell.textContent.trim() === PLAN_UNREAD_MARK);
                const termCell = row.cells[termColumn];
                if (!unreadCell || !termCell) return;

                const courseCode = cells[1].textContent.trim();
                const courseName = cells[2].textContent.trim();
                if (!/^\d+$/.test(courseCode) || !courseName) return;

                row.dataset.planAccessEnhanced = 'true';
                queryCourseAccess(courseCode).then(selectable => {
                    if (!selectable) return;
                    // 请求期间课程可能已被选上、退掉或表格已重绘，确认两个单元格仍是原样再写入
                    if (unreadCell.textContent.trim() !== PLAN_UNREAD_MARK) return;
                    // “未读”可能本来就落在当前学期列上，此时该单元格就是未读单元格，无需再判空
                    if (termCell !== unreadCell && termCell.textContent.trim() !== '') return;

                    unreadCell.textContent = '';
                    termCell.textContent = '';

                    const link = document.createElement('a');
                    link.textContent = PLAN_SELECTABLE_MARK;
                    link.title = '该课程本次可选，点击查看班次列表';
                    link.style.cursor = 'pointer';
                    link.style.color = '#3c9d3c';
                    link.style.textDecoration = 'none';
                    // selectScope 优先读链接上的课程代码，这样链接文本可以自由改写
                    link.dataset.courseCode = courseCode;
                    link.addEventListener('click', () => pageWindow.selectScope(link));
                    termCell.appendChild(link);
                });
            });
        });
    }

    // 单元格默认左对齐，此处统一居中
    function addPlanTableStyle() {
        if (document.getElementById('planTableStyle')) return;

        const style = document.createElement('style');
        style.id = 'planTableStyle';
        style.textContent = `#${PLAN_TABLE_ID} th, #${PLAN_TABLE_ID} td { text-align: center; }`;
        document.head.appendChild(style);
    }

    // 班次列表弹窗的表格由 DataTables 生成，表头居中而数据行左对齐，这里统一居中
    function addClassListTableStyle() {
        if (document.getElementById('classListTableStyle')) return;

        const style = document.createElement('style');
        style.id = 'classListTableStyle';
        style.textContent = `#${CLASS_LIST_TABLE_ID} th, #${CLASS_LIST_TABLE_ID} td { text-align: center; }`;
        document.head.appendChild(style);
    }

    // 培养计划页面原本只有部分课程的“课程编号”能打开班次列表，
    // 这里统一改为点击“课程名称”打开，并为其追加“教学大纲”“教学日历”两个按钮
    function enhancePlanCourseTable() {
        if (!sitePath().startsWith('/dhu/selectcourse/toSH')) return;

        const table = document.getElementById(PLAN_TABLE_ID);
        if (!table) return;

        addPlanTableStyle();
        enhancePlanTableHeader(table);

        // 表格内容由 selecthome.js 重新渲染，故每次都要重新处理；已处理的行打标记跳过
        table.querySelectorAll('tbody tr').forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length !== PLAN_TABLE_COLUMNS) return;

            const courseCode = cells[1].textContent.trim();
            const courseName = cells[2].textContent.trim();
            // 课程行以外还有分类标题行（colspan 跨列），以“课程编号为纯数字”区分
            if (!/^\d+$/.test(courseCode) || !courseName || /^[\d.]+$/.test(courseName)) return;
            if (row.dataset.planCourseEnhanced === 'true') return;

            row.dataset.planCourseEnhanced = 'true';
            enhancePlanCourseRow(cells, courseCode, courseName);
        });

        enhanceEnrolledMarks(table);
        // 必须在课程行追加完教学大纲、教学日历两列之后执行，否则探测到的学期列号会偏移两格
        enhanceUnreadCourses(table);
        syncPlanRowColspans(table);
    }

    // 培养计划页面的“其它课程”区块
    // 其它课程不计入培养计划，服务端渲染的培养计划表格里没有它们。
    // selecthome.js 的 initCourses() 会请求 initTSCourses，但只取结果中的 tsCourses，otherScore 被丢弃，
    // 这里补一个按钮，点击后才重新请求并追加到培养计划表格末尾，避免每次打开页面都多渲染一段内容
    const OTHER_COURSES_BAR_ID = 'otherCoursesBar';
    // 与培养计划表格里的分类一致，其它课程归入“其它课程/选修课”
    const OTHER_COURSES_CATEGORY = '其它课程';
    const OTHER_COURSES_KIND = '选修课';

    // 学分与“已选/成绩”的呈现方式与成绩查询页面 coursegrade.js 的 parseYearTermOtherCourse 一致：
    // 课程所在学期由 DIFFYEAR（相对当前学期的学年偏移）与 TERM（a/s）换算而来
    function otherCourseTermIndex(course) {
        const diffYear = (course.DIFFYEAR == null || course.DIFFYEAR < 0) ? 0 : course.DIFFYEAR;
        return diffYear * 2 + (course.TERM === 's' ? 2 : 1);
    }

    // 行结构与培养计划表格保持一致：分类标题行 + 课程行，
    // 课程行沿用 enhancePlanCourseRow 处理，因此点击课程名称同样可以打开班次列表，
    // 教学大纲、教学日历两列也可用
    function buildOtherCoursesRows(courses, table) {
        const headerRows = table.querySelectorAll('thead tr');
        const termCount = headerRows[headerRows.length - 1].children.length;
        const columnCount = planTableColumnCount(table);

        const kindRow = document.createElement('tr');
        kindRow.className = 'fbold';
        const kindCategoryCell = document.createElement('td');
        kindCategoryCell.textContent = OTHER_COURSES_CATEGORY;
        kindRow.appendChild(kindCategoryCell);

        const kindCell = document.createElement('td');
        kindCell.colSpan = Math.max(1, columnCount - 1);
        const kindSpan = document.createElement('span');
        kindSpan.className = 'crKind';
        kindSpan.style.fontWeight = 'bold';
        kindSpan.textContent = OTHER_COURSES_KIND;
        kindCell.appendChild(kindSpan);
        kindRow.appendChild(kindCell);

        const rows = [kindRow];

        courses.forEach(course => {
            const row = document.createElement('tr');
            const cells = [];

            const categoryCell = document.createElement('td');
            categoryCell.textContent = OTHER_COURSES_CATEGORY;
            row.appendChild(categoryCell);
            cells.push(categoryCell);

            const codeCell = document.createElement('td');
            codeCell.textContent = course.KCBH || '';
            row.appendChild(codeCell);
            cells.push(codeCell);

            const nameCell = document.createElement('td');
            nameCell.textContent = course.KCMC || '';
            row.appendChild(nameCell);
            cells.push(nameCell);

            const creditCell = document.createElement('td');
            creditCell.textContent = course.XF ? Number(course.XF).toFixed(1) : '';
            row.appendChild(creditCell);
            cells.push(creditCell);

            // 成绩与“已选”的呈现方式与成绩查询页面 coursegrade.js 的 parseYearTermOtherCourse 一致：
            // 课程所在学期由 DIFFYEAR（相对当前学期的学年偏移）与 TERM（a/s）换算而来
            const termIndex = otherCourseTermIndex(course);
            for (let i = 1; i <= termCount; i++) {
                const cell = document.createElement('td');
                if (i === termIndex) cell.textContent = course.CJ || '已选';
                row.appendChild(cell);
            }

            cells.push(...Array.from(row.children).slice(4));
            enhancePlanCourseRow(cells, course.KCBH || '', course.KCMC || '');
            rows.push(row);
        });

        return rows;
    }

    // 其它课程数量为 0 时不显示按钮，因此需要在页面加载时先查询一次数量；
    // 查询只做一次，失败时允许后续重试
    let otherCoursesState = 'idle';
    // 展开状态下其它课程行需要重绘，由 buildOtherCoursesToggle 写入
    let refreshOtherCoursesSection = () => { };

    function queryOtherCourses(onSuccess, onError) {
        $.ajax({
            url: pageWindow.contextPath + '/selectcourse/initTSCourses',
            type: 'POST',
            dataType: 'json',
            cache: false,
            data: { studNo: pageWindow.studNo, scSemester: pageWindow.scSemester, type: 'selectCourse' },
            success: result => {
                onSuccess((result && result.success && result.otherScore) ? result.otherScore : []);
            },
            error: () => {
                onError();
            }
        });
    }

    function addOtherCoursesToggle() {
        if (!sitePath().startsWith('/dhu/selectcourse/toSH')) return;
        if (otherCoursesState !== 'idle') return;

        const table = document.getElementById(PLAN_TABLE_ID);
        if (!table || !table.parentNode) return;

        otherCoursesState = 'loading';
        queryOtherCourses(courses => {
            if (courses.length === 0) {
                otherCoursesState = 'empty';
                return;
            }
            otherCoursesState = 'ready';
            buildOtherCoursesToggle(table);
        }, () => {
            otherCoursesState = 'idle';
        });
    }

    function buildOtherCoursesToggle(table) {
        if (document.getElementById(OTHER_COURSES_BAR_ID)) return;

        const bar = document.createElement('div');
        bar.id = OTHER_COURSES_BAR_ID;
        bar.style.textAlign = 'center';
        bar.style.marginTop = '10px';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn blue';
        button.textContent = '展开其它课程';
        bar.appendChild(button);

        let expandedRows = [];
        let loading = false;

        const collapse = () => {
            expandedRows.forEach(row => row.remove());
            expandedRows = [];
            button.textContent = '展开其它课程';
        };

        // 展开期间其它课程可能被选上或退掉，缓存的列表会过期，因此每次展开都重新查询，
        // 查询结果为空说明已经没有其它课程，此时连同按钮一起移除
        const expand = () => {
            const tbody = table.querySelector('tbody');
            if (!tbody) return;

            loading = true;
            button.disabled = true;
            button.textContent = '加载中...';

            queryOtherCourses(courses => {
                loading = false;
                button.disabled = false;

                if (courses.length === 0) {
                    otherCoursesState = 'empty';
                    bar.remove();
                    return;
                }

                // 表格末尾的空行只用于撑出圆角，新内容插在它之前
                const lastRow = tbody.lastElementChild;
                const anchor = (lastRow && lastRow.children.length === 1 && !lastRow.textContent.trim()) ? lastRow : null;

                buildOtherCoursesRows(courses, table).forEach(row => {
                    tbody.insertBefore(row, anchor);
                    expandedRows.push(row);
                });
                button.textContent = '收起其它课程';
            }, () => {
                loading = false;
                button.disabled = false;
                button.textContent = '展开其它课程';
            });
        };

        button.addEventListener('click', () => {
            if (loading) return;
            if (expandedRows.length > 0) collapse();
            else expand();
        });

        // 退课会改变其它课程的构成，展开状态下需要重新查询并重绘，折叠时下次展开本来就会重新查询
        refreshOtherCoursesSection = () => {
            if (loading || expandedRows.length === 0) return;
            collapse();
            expand();
        };

        table.parentNode.insertBefore(bar, table.nextSibling);
    }

    // 培养计划页面底部的超星学习通自选课程入口
    // 学习通是站外系统，与教务系统之间只有链接跳转、没有数据交换，因此只追加一个链接
    const CHAOXING_ENTRY_ID = 'chaoxingEntry';
    const CHAOXING_PORTAL_URL = 'https://dhu1.fanya.chaoxing.com/portal';

    function addChaoxingEntry() {
        if (!sitePath().startsWith('/dhu/selectcourse/toSH')) return;
        if (document.getElementById(CHAOXING_ENTRY_ID)) return;

        const table = document.getElementById(PLAN_TABLE_ID);
        if (!table || !table.parentNode) return;

        const entry = document.createElement('div');
        entry.id = CHAOXING_ENTRY_ID;
        entry.style.textAlign = 'center';
        entry.style.marginTop = '10px';

        const link = document.createElement('a');
        link.textContent = '超星学习通自选课程';
        link.title = CHAOXING_PORTAL_URL;
        link.style.fontSize = '14px';
        link.style.color = '#0066cc';
        link.href = toAccessibleUrl(CHAOXING_PORTAL_URL);
        link.target = '_blank';

        entry.appendChild(link);
        // 追加到表格所在容器的末尾，即页面正文的最底部；
        // 其它课程的行都插在表格内部，“其它课程”按钮也在表格之后插入，均位于此处之上
        table.parentNode.appendChild(entry);
    }

    // 删除"选课注意事项"按钮
    function removeNoticeButton() {
        const links = document.querySelectorAll('a[onclick*="showNotice"]');
        links.forEach(link => link.remove());
    }

    // 简化 toSCC 页面顶部的课程数量提示
    // 原页面会写“共有 N 门课，大英类同一级别不重复计算学分！…”，说明文字随年级在 #elesyq
    // （2024 级及以前）与 #elesyh（2025 级及以后）之间切换，两者都移除，只保留“共有 N 门课”，
    // 并让它另起一行居中显示
    function simplifySccNotice() {
        if (!sitePath().startsWith('/dhu/selectcourse/toSCC')) return;

        // #courseCnt 由页面的 initCourses() 反复改写，但只改文本，不会重建外层结构，
        // 因此这里的调整只需做一次
        const courseCnt = document.getElementById('courseCnt');
        const countSpan = courseCnt && courseCnt.parentElement;
        if (!countSpan || countSpan.dataset.simplified === 'true') return;

        document.getElementById('elesyq')?.remove();
        document.getElementById('elesyh')?.remove();

        // 去掉数量后面残留的“，”
        countSpan.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                node.textContent = node.textContent.replace(/，/g, '');
            }
        });

        // 外层 div 已是 text-align:center，换行后两行各自居中；
        // 行内元素不接受垂直外边距，故将数量行改为 inline-block 以便与上一行拉开间距
        countSpan.parentElement.insertBefore(document.createElement('br'), countSpan);
        countSpan.style.display = 'inline-block';
        countSpan.style.marginTop = '8px';

        countSpan.dataset.simplified = 'true';
    }

    // 删除荣誉课程表格
    // 该汇总表块由选课页面的 selecthome.js 追加到 #tsCoursesTbl 中，其首个单元格固定为“荣誉课程”；
    // 限定在该表格内精确匹配，避免误删其他页面中名称含“荣誉课程”字样的普通课程
    function removeHonorsCourses() {
        const rows = document.querySelectorAll('#tsCoursesTbl tr');
        rows.forEach(row => {
            const firstCell = row.querySelector('td');
            if (firstCell && firstCell.textContent.trim() === '荣誉课程') {
                row.remove();
            }
        });
    }

    // ---- 左侧课程表侧边栏 ----
    // 选课时经常要确认某个时间段是否已经排课，这里把课程表页面（StudentCourseTable）的能力
    // 搬成侧边栏：学期列表取自 /common/semesterSS，课表由 /StudentCourseTable/getData 渲染，
    // 与课程表页面自身用的是同一组接口。getData 使用会话中的学生，因此不必传学号
    const COURSE_TABLE_SIDEBAR_ID = 'courseTableSidebar';
    const COURSE_TABLE_HANDLE_ID = 'courseTableSidebarHandle';
    const COURSE_TABLE_TERM_ID = 'courseTableSidebarTerm';
    const COURSE_TABLE_STYLE_ID = 'courseTableSidebarStyle';
    const COURSE_TABLE_WIDTH_KEY = 'dhuCourseTableWidth';
    const COURSE_TABLE_TERM_KEY = 'dhuCourseTableTerm';
    const COURSE_TABLE_WIDTH_DEFAULT = 560;
    // 与课程表页面下方那张表的列一致
    const COURSE_TABLE_NOTIME_COLUMNS = ['选课序号', '课程代码', '课程名称', '组班序号', '授课教师'];

    // 学期列表只在首次展开时拉取，收起状态下不产生额外请求
    let courseTableTerms = null;

    function addCourseTableSidebarStyle() {
        if (document.getElementById(COURSE_TABLE_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = COURSE_TABLE_STYLE_ID;
        style.textContent = `
            /* 页头（.header_sui，固定定位且高 50px）会盖住左上角，把手从页头下沿开始贴左显示 */
            #${COURSE_TABLE_HANDLE_ID} {
                position: fixed; left: 0; top: 50px;
                z-index: 1030; padding: 6px 12px; cursor: pointer;
                font-size: 13px; line-height: 1; letter-spacing: 1px; user-select: none;
                color: #fff; background: #4b8df8;
                border-radius: 0 0 4px 0; box-shadow: 0 1px 6px rgba(0, 0, 0, .25);
            }
            #${COURSE_TABLE_HANDLE_ID}:hover { background: #3b7ee0; }

            /* 面板位于页头（z-index 9995）之下、bootstrap 弹窗（1050）之上，
               这样弹窗仍能盖住侧边栏，查看大纲/班次列表时不会被遮挡 */
            #${COURSE_TABLE_SIDEBAR_ID} {
                position: fixed; left: 0; top: 50px; width: 560px; z-index: 1030;
                /* 高度跟随内容，课表下方不留大片空白；超出可视区域时只在 .cts-body 内滚动 */
                max-height: calc(100vh - 50px);
                display: flex; flex-direction: column;
                background: #fff; border-right: 1px solid #d4d4d4;
                box-shadow: 2px 0 12px rgba(0, 0, 0, .18);
                font-size: 12px; color: #333;
                transform: translateX(-100%); transition: transform .18s ease-out;
            }
            #${COURSE_TABLE_SIDEBAR_ID}.cts-open { transform: translateX(0); }

            #${COURSE_TABLE_SIDEBAR_ID} .cts-head {
                flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
                padding: 8px 10px; background: #f7f7f7; border-bottom: 1px solid #e5e5e5;
            }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-title { font-size: 13px; font-weight: bold; white-space: nowrap; }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-term { flex: 1 1 auto; min-width: 0; height: 26px; font-size: 12px; }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-close {
                flex: 0 0 auto; padding: 0 4px; font-size: 18px; line-height: 1;
                color: #888; background: transparent; border: 0; cursor: pointer;
            }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-close:hover { color: #333; }

            #${COURSE_TABLE_SIDEBAR_ID} .cts-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px; }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-hint { padding: 12px 4px; color: #999; text-align: center; }

            /* 服务端课表是按整页宽度排的，压进侧边栏后列宽交给浏览器均分，长课名换行显示 */
            #${COURSE_TABLE_SIDEBAR_ID} .cts-timetable table {
                width: 100%; margin: 0; border-collapse: collapse; table-layout: fixed; font-size: 11px;
            }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-timetable td {
                padding: 3px 2px; text-align: center; vertical-align: middle;
                word-break: break-all; line-height: 1.35; border: 1px solid #999;
            }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-timetable td:first-child { width: 38px; background: #f5f5f5; }

            /* 未设置上课时间的课程（期末实践类、暑期课程等）跟在课表下方 */
            #${COURSE_TABLE_SIDEBAR_ID} .cts-notime { margin-top: 12px; }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-notime-tip { margin-bottom: 6px; color: #666; line-height: 1.5; }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-notime-table { width: 100%; margin: 0; border-collapse: collapse; font-size: 11px; }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-notime-table th,
            #${COURSE_TABLE_SIDEBAR_ID} .cts-notime-table td {
                padding: 3px 2px; text-align: center; vertical-align: middle;
                word-break: break-all; line-height: 1.35; border: 1px solid #999;
            }
            #${COURSE_TABLE_SIDEBAR_ID} .cts-notime-table th { background: #f5f5f5; }

            #${COURSE_TABLE_SIDEBAR_ID} .cts-resizer {
                position: absolute; top: 0; right: -3px; bottom: 0; width: 6px; cursor: col-resize;
            }`;
        document.head.appendChild(style);
    }

    function courseTableStore(key, value) {
        try {
            if (value === undefined) return window.localStorage.getItem(key);
            window.localStorage.setItem(key, value);
        } catch (e) {
            // 隐私模式等场景下 localStorage 不可用，退化为不记忆即可
        }
        return null;
    }

    function courseTableContextPath() {
        return pageWindow.contextPath || '/dhu';
    }

    // 20262027a → 2026-2027 学年 第 1 学期，与课程表页面标题的写法保持一致
    function formatCourseTableTerm(name) {
        const matched = /^(\d{4})(\d{4})([as])$/.exec(String(name || ''));
        if (!matched) return String(name || '');
        return matched[1] + '-' + matched[2] + ' 学年 第 ' + (matched[3] === 'a' ? 1 : 2) + ' 学期';
    }

    function courseTableContent() {
        return document.querySelector('#' + COURSE_TABLE_SIDEBAR_ID + ' .cts-content');
    }

    function showCourseTableMessage(text) {
        const content = courseTableContent();
        if (!content) return;

        content.innerHTML = '';
        const hint = document.createElement('div');
        hint.className = 'cts-hint';
        hint.textContent = text;
        content.appendChild(hint);
    }

    // 表头行与“节”列以外的单元格才是课程，据此判断该学期是否排了课
    function courseTableHasCourses(html) {
        const holder = document.createElement('div');
        holder.innerHTML = html;
        const table = holder.querySelector('table');
        if (!table) return false;

        return Array.prototype.some.call(table.rows, (row, index) =>
            index > 0 && Array.prototype.some.call(row.cells,
                cell => cell.cellIndex >= 1 && cell.textContent.trim() !== ''));
    }

    function renderCourseTable(term, result) {
        const content = courseTableContent();
        const body = document.querySelector('#' + COURSE_TABLE_SIDEBAR_ID + ' .cts-body');
        if (!content) return;

        content.innerHTML = '';
        if (!courseTableHasCourses(result.content)) {
            const hint = document.createElement('div');
            hint.className = 'cts-hint';
            hint.textContent = formatCourseTableTerm(term.name) + ' 暂无课程安排';
            content.appendChild(hint);
        }
        content.insertAdjacentHTML('beforeend', '<div class="cts-timetable">' + result.content + '</div>');

        const noTimeCourses = renderNoTimeCourses(term, result.list);
        if (noTimeCourses) content.appendChild(noTimeCourses);

        if (body) body.scrollTop = 0;
    }

    // getData 的 list 只包含没有排进课表格子的课程，即课程表页面下方的
    // “本学期没有设置上课时间的课程”（期末实践类、暑期课程等），这里照搬同一份数据
    function renderNoTimeCourses(term, list) {
        if (!list || !list.length) return null;

        const section = document.createElement('div');
        section.className = 'cts-notime';

        const tip = document.createElement('div');
        tip.className = 'cts-notime-tip';
        tip.textContent = '以下是' + formatCourseTableTerm(term.name) + '没有设置上课时间的课程'
            + '（包括期末实践类、暑期课程等。实践类课程由学院安排，暑期课程上课时间在教务处主页通知公布。）';
        section.appendChild(tip);

        const table = document.createElement('table');
        table.className = 'cts-notime-table';
        const head = document.createElement('thead');
        head.innerHTML = '<tr>' + COURSE_TABLE_NOTIME_COLUMNS.map(name => '<th>' + name + '</th>').join('') + '</tr>';
        table.appendChild(head);

        const tbody = document.createElement('tbody');
        list.forEach(item => {
            const row = document.createElement('tr');
            [item.ID, item.KCBH, item.KCMC, item.SZBH, item.XM].forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = value == null ? '' : value;
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        section.appendChild(table);
        return section;
    }

    function loadCourseTable(term) {
        showCourseTableMessage('正在加载课程表…');
        $.ajax({
            url: courseTableContextPath() + '/StudentCourseTable/getData',
            type: 'POST',
            dataType: 'json',
            data: { yearTermId: term.id, yearTermName: term.name },
            success: function (result) {
                if (!result || !result.success || !result.content) {
                    showCourseTableMessage('课程表加载失败' + (result && result.msg ? '：' + result.msg : ''));
                    return;
                }
                renderCourseTable(term, result);
            },
            error: function () {
                showCourseTableMessage('课程表加载失败，请稍后重试。');
            }
        });
    }

    // 优先用上次看过的学期，其次当前学期（接口里 current 为 1），最后退回列表首个即最新学期
    function pickCourseTableTerm() {
        if (!courseTableTerms || !courseTableTerms.length) return null;

        const saved = courseTableStore(COURSE_TABLE_TERM_KEY);
        return courseTableTerms.find(term => term.name === saved)
            || courseTableTerms.find(term => term.current == 1)
            || courseTableTerms[0];
    }

    function fillCourseTableTermSelect() {
        const select = document.getElementById(COURSE_TABLE_TERM_ID);
        if (!select) return;

        select.innerHTML = '';
        courseTableTerms.forEach(term => {
            const option = document.createElement('option');
            option.value = term.id;
            option.textContent = formatCourseTableTerm(term.name);
            select.appendChild(option);
        });

        const picked = pickCourseTableTerm();
        if (picked) select.value = picked.id;
    }

    function ensureCourseTableTerms() {
        showCourseTableMessage('正在加载学期列表…');
        $.ajax({
            url: courseTableContextPath() + '/common/semesterSS',
            type: 'POST',
            dataType: 'json',
            data: { ordered: true, sortType: 'desc' },
            success: function (result) {
                if (!result || !result.success || !result.semesterSS || !result.semesterSS.length) {
                    showCourseTableMessage('学期列表加载失败' + (result && result.msg ? '：' + result.msg : ''));
                    return;
                }

                courseTableTerms = result.semesterSS;
                fillCourseTableTermSelect();
                const picked = pickCourseTableTerm();
                if (picked) {
                    loadCourseTable(picked);
                } else {
                    showCourseTableMessage('未找到可用的学期。');
                }
            },
            error: function () {
                showCourseTableMessage('学期列表加载失败，请稍后重试。');
            }
        });
    }

    function openCourseTableSidebar() {
        const panel = document.getElementById(COURSE_TABLE_SIDEBAR_ID);
        const handle = document.getElementById(COURSE_TABLE_HANDLE_ID);
        if (!panel) return;

        panel.classList.add('cts-open');
        if (handle) handle.style.display = 'none';
        if (!courseTableTerms) ensureCourseTableTerms();
    }

    function closeCourseTableSidebar() {
        const panel = document.getElementById(COURSE_TABLE_SIDEBAR_ID);
        const handle = document.getElementById(COURSE_TABLE_HANDLE_ID);
        if (panel) panel.classList.remove('cts-open');
        if (handle) handle.style.display = '';
    }

    function courseTableWidth(width) {
        const max = Math.max(320, Math.min(1000, document.documentElement.clientWidth - 120));
        return Math.min(Math.max(width, 320), max);
    }

    function installCourseTableResizer(panel, resizer) {
        let dragging = false;

        resizer.addEventListener('mousedown', event => {
            dragging = true;
            event.preventDefault();
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', event => {
            if (!dragging) return;
            panel.style.width = courseTableWidth(event.clientX - panel.getBoundingClientRect().left) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.userSelect = '';
            courseTableStore(COURSE_TABLE_WIDTH_KEY, parseInt(panel.style.width, 10));
        });
    }

    function addCourseTableSidebar() {
        if (document.getElementById(COURSE_TABLE_SIDEBAR_ID)) return;

        addCourseTableSidebarStyle();

        const handle = document.createElement('div');
        handle.id = COURSE_TABLE_HANDLE_ID;
        handle.title = '查看课程表';
        handle.textContent = '课程表';

        const panel = document.createElement('div');
        panel.id = COURSE_TABLE_SIDEBAR_ID;
        panel.innerHTML = `
            <div class="cts-head">
                <span class="cts-title">课程表</span>
                <select id="${COURSE_TABLE_TERM_ID}" class="cts-term"></select>
                <button type="button" class="cts-close" title="收起">&laquo;</button>
            </div>
            <div class="cts-body"><div class="cts-content"></div></div>
            <div class="cts-resizer" title="拖动调整宽度"></div>`;

        document.body.appendChild(handle);
        document.body.appendChild(panel);

        const savedWidth = parseInt(courseTableStore(COURSE_TABLE_WIDTH_KEY), 10);
        panel.style.width = courseTableWidth(savedWidth || COURSE_TABLE_WIDTH_DEFAULT) + 'px';

        handle.addEventListener('click', openCourseTableSidebar);
        panel.querySelector('.cts-close').addEventListener('click', closeCourseTableSidebar);
        document.getElementById(COURSE_TABLE_TERM_ID).addEventListener('change', event => {
            const term = (courseTableTerms || []).find(item => String(item.id) === event.target.value);
            if (!term) return;

            courseTableStore(COURSE_TABLE_TERM_KEY, term.name);
            loadCourseTable(term);
        });
        installCourseTableResizer(panel, panel.querySelector('.cts-resizer'));
    }

    // 初始化
    function init() {
        addModal();
        addSwapCourseModal();
        defineShowCourseProp();
        enhanceViewCourseMaterial();
        enhanceMaterialDownload();
        addClassListTableStyle();
        installSubmitWatcher();
        removeNoticeButton();
        removeHonorsCourses();
        enhancePlanCourseTable();
        addOtherCoursesToggle();
        addChaoxingEntry();
        simplifySccNotice();

        // 监听DOM变化（处理动态加载内容）
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    removeHonorsCourses();
                    enhancePlanCourseTable();
                    addOtherCoursesToggle();
                    addChaoxingEntry();
                    simplifySccNotice();
                }
            });
        });

        // 监听整个body变化，捕获动态加载的表格内容
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // 从单个页面解析选课手册
    function parseHandbooksFromHTML(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const links = doc.querySelectorAll('a[href*="page.htm"]');
        const handbooks = [];

        links.forEach(link => {
            const text = link.textContent.trim();
            const match = text.match(/(\d{4})级本科生选课手册/);
            if (match) {
                const year = match[1];
                const href = link.getAttribute('href');
                handbooks.push({
                    year: year,
                    name: text,
                    url: 'https://jw.dhu.edu.cn' + href
                });
            }
        });

        return handbooks;
    }

    // 获取总页数
    function getTotalPages(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const allPages = doc.querySelector('.all_pages');
        return allPages ? parseInt(allPages.textContent) || 1 : 1;
    }

    // 从教务处网站获取所有页面的选课手册
    function fetchLatestHandbooks(callback) {
        // 先请求第一页获取总页数
        fetchExternalText('https://jw.dhu.edu.cn/9960/list1.htm',
            function (html) {
                const totalPages = getTotalPages(html);
                const firstPageHandbooks = parseHandbooksFromHTML(html);

                if (totalPages <= 1) {
                    callback(firstPageHandbooks);
                    return;
                }

                // 请求剩余页面
                const remainingPages = [];
                for (let i = 2; i <= totalPages; i++) {
                    remainingPages.push(i);
                }

                let completed = 0;
                const allHandbooks = [...firstPageHandbooks];

                remainingPages.forEach(pageNum => {
                    fetchExternalText(`https://jw.dhu.edu.cn/9960/list${pageNum}.htm`,
                        function (html) {
                            const pageHandbooks = parseHandbooksFromHTML(html);
                            allHandbooks.push(...pageHandbooks);
                            completed++;

                            if (completed === remainingPages.length) {
                                // 去重（按年级）并倒序排列
                                const uniqueHandbooks = [];
                                const seenYears = new Set();
                                allHandbooks.forEach(h => {
                                    if (!seenYears.has(h.year)) {
                                        seenYears.add(h.year);
                                        uniqueHandbooks.push(h);
                                    }
                                });
                                uniqueHandbooks.sort((a, b) => parseInt(b.year) - parseInt(a.year));
                                callback(uniqueHandbooks);
                            }
                        },
                        function () {
                            completed++;
                            if (completed === remainingPages.length) {
                                allHandbooks.sort((a, b) => parseInt(b.year) - parseInt(a.year));
                                callback(allHandbooks);
                            }
                        }
                    );
                });
            },
            function () {
                console.error('获取选课手册失败');
                callback([]);
            }
        );
    }

    // 增强选课手册按钮
    function enhanceHandbookButton() {
        const originalShowScmTbl = pageWindow.showScmTbl;
        if (!originalShowScmTbl || pageWindow.showScmTblEnhanced) return;

        pageWindow.showScmTbl = function () {
            // 先调用原函数显示侧边栏
            originalShowScmTbl.call(pageWindow);

            // 延迟获取最新手册并替换内容（等待原函数加载完成）
            setTimeout(function () {
                fetchLatestHandbooks(function (handbooks) {
                    if (handbooks.length === 0) return;

                    const scmList = document.getElementById('scmList');
                    if (!scmList) return;

                    // 清空原有内容
                    scmList.innerHTML = '';

                    // 添加新的手册链接
                    handbooks.forEach(function (handbook) {
                        const btnGroup = document.createElement('div');
                        btnGroup.className = 'btn-group';
                        btnGroup.style.marginBottom = '0px !important';

                        const span = document.createElement('span');
                        span.className = 'btn blue';
                        span.style.cursor = 'default';
                        span.textContent = handbook.year + '级';

                        const link = document.createElement('a');
                        link.className = 'btn';
                        link.style.backgroundColor = '#c3c3c3';
                        link.style.color = 'red';
                        link.style.fontWeight = 'bold';
                        link.textContent = handbook.name;
                        link.href = toAccessibleUrl(handbook.url);
                        link.target = '_blank';

                        btnGroup.appendChild(span);
                        btnGroup.appendChild(link);
                        scmList.appendChild(btnGroup);
                    });
                });
            }, 500);
        };

        pageWindow.showScmTblEnhanced = true;
    }

    // 增强 selectScope 函数，允许已修/已选/已通过课程查看班次列表
    function enhanceSelectScope() {
        if (!pageWindow.selectScope || pageWindow.selectScopeEnhanced) return;

        const originalSelectScope = pageWindow.selectScope;
        // 这些页面的课程代码位于课程名称所在单元格的下一列
        const COURSE_CODE_NEXT_CELL_PAGES = ['/toSCC', '/toSelectByOrgn', '/toOEC'];
        const isCourseNamePage = COURSE_CODE_NEXT_CELL_PAGES.some(page =>
            sitePath().endsWith(page)
        );

        pageWindow.selectScope = function (aNode) {
            closeFailureMsg();

            const $aNode = $(aNode);

            // 根据页面类型获取课程代码
            // 培养计划页面的课程名称链接直接把代码挂在 data-course-code 上
            let courseCode = $aNode.attr('data-course-code');
            if (!courseCode) {
                if (isCourseNamePage) {
                    // toSCC/toSelectByOrgn/toOEC页面：课程代码在课程名称的下一个td中
                    courseCode = $aNode.parent().next('td').html();
                } else {
                    // toSH页面：课程代码在链接文本中
                    courseCode = $aNode.html();
                }
            }
            if (!isCourseNamePage) {
                // 高亮选中的行
                $('#tsCoursesTbl tr.choseTr').removeClass('choseTr');
                $($aNode.parents('tr')[0]).addClass('choseTr');
            }

            $.ajax({
                url: contextPath + '/selectcourse/accessJudge',
                type: 'POST',
                dataType: 'json',
                data: { courseCode: courseCode },
                async: false,
                success: function (result) {
                    if (result.success) {
                        // 原有逻辑：有权限时正常打开
                        if (result.warnings && 0 < result.warnings.length) {
                            $('#warnMsg').html('<i class="icon-warning-sign"></i>' + result.warnings.join('；'));
                        } else {
                            $('#warnMsg').html('');
                        }
                        openSCFld(courseCode);
                        if (!isCourseNamePage) {
                            $('#opeCr').val(courseCode);
                        }
                    } else {
                        // 增强逻辑：无权限时（已修/已选/已通过），仍尝试打开班次列表
                        const errorMsg = result.msg || '';
                        const isAlreadyTaken = errorMsg.includes('已经选了') ||
                            errorMsg.includes('已修') ||
                            errorMsg.includes('已选') ||
                            errorMsg.includes('已经通过了');

                        if (isAlreadyTaken) {
                            // 显示提示信息
                            $('#warnMsg').html('<i class="icon-warning-sign"></i>' + errorMsg);
                            // 仍然打开班次列表（只读）
                            openSCFld(courseCode);
                            if (!isCourseNamePage) {
                                $('#opeCr').val(courseCode);
                            }
                        } else {
                            // 其他错误正常显示
                            $('#failureMsg').html(errorMsg);
                            $('#failureMsgFld').css('display', '');
                        }
                    }
                },
                error: function () {
                    alert('');
                }
            });
        };

        pageWindow.selectScopeEnhanced = true;
    }

    // 换课：课程已选时，可直接在班次列表里切到其他班次。
    // 选课接口对已选课程会直接拒绝，需要先退掉当前班次再重新选课；
    // 若新班次名额已被占用导致选课失败，则按原样把原班次选回来

    // 冲突提示可能让用户等待、提交也可能迟迟不返回，靠这个延时兜底确认课程的最终状态
    const SWAP_SETTLE_DELAY = 20000;

    // initSelCourses 返回本学期选课记录，其中已录取课程的 jxbdm 即当前班次的选课序号。
    // 学生可能在别处退课，这里每次都重新查询，不做缓存
    let originalSelectSubmitRef = null;

    // 退课接口 /selectcourse/cancelSC 靠 cancelType 区分两组课程，
    // 取值与 toSSC 页面“已被录取课程组”和“第一次选课志愿课程组”的删除按钮一致
    const CANCEL_TYPE_ENROLLED = 1;
    const CANCEL_TYPE_VOLUNTEER = 2;

    // 志愿型选课模式下，选课先落进志愿列表，选课关闭时才按名额分配，
    // 因此 initSelCourses 会同时返回 enrollCourses（已录取）与 selectedCourses（志愿）。
    // 两组课程要用不同的 cancelType 退课，这里合并成一份列表并带上来源
    function taggedSelectedCourses(courses, cancelType) {
        return (courses || []).map(course => Object.assign({}, course, { cancelType: cancelType }));
    }

    function loadSelectedCourses() {
        return new Promise(resolve => {
            $.ajax({
                url: contextPath + '/selectcourse/initSelCourses',
                type: 'POST',
                dataType: 'json',
                success: result => {
                    if (!result || !result.success) {
                        resolve(null);
                        return;
                    }

                    resolve(taggedSelectedCourses(result.enrollCourses, CANCEL_TYPE_ENROLLED)
                        .concat(taggedSelectedCourses(result.selectedCourses, CANCEL_TYPE_VOLUNTEER)));
                },
                error: () => resolve(null)
            });
        });
    }

    // 志愿尚未录取，撤销它不会释放名额；已录取的课程退课后名额会被他人占用
    function isVolunteerCourse(course) {
        return !!course && course.cancelType === CANCEL_TYPE_VOLUNTEER;
    }

    // 选课提交的参数由页面各自拼装（是否选教材、验证码、学科基础等各不相同），
    // 换课失败后要按同样的参数重选原班次，故包裹 $.ajax 截获一次 scSubmit 调用
    let submitWatcher = null;

    function installSubmitWatcher() {
        if (!$.ajax || $.ajax.watchScSubmit) return;

        const originalAjax = $.ajax;
        const wrappedAjax = function (options) {
            const url = options && typeof options.url === 'string' ? options.url : '';
            if (!submitWatcher || url.indexOf('/selectcourse/scSubmit') === -1) {
                return originalAjax.apply(this, arguments);
            }

            // 先让页面自己的成功/失败回调跑完（其中的弹窗会阻塞），再把结果交给换课逻辑
            const watcher = submitWatcher;
            const originalSuccess = options.success;
            const originalError = options.error;

            return originalAjax.call(this, $.extend({}, options, {
                success: function (result) {
                    if (originalSuccess) originalSuccess.apply(this, arguments);
                    watcher(options.data, result);
                },
                error: function () {
                    if (originalError) originalError.apply(this, arguments);
                    watcher(options.data, null);
                }
            }));
        };

        wrappedAjax.watchScSubmit = true;
        $.ajax = wrappedAjax;
    }

    // 班次列表弹窗本身的 z-index 是 10050，换课确认弹窗必须更高才能盖住它
    function addSwapCourseModal() {
        if (document.getElementById('swapCourseFld')) return;

        document.body.insertAdjacentHTML('beforeend', `
        <div id="swapCourseFld"
             style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,0.45);z-index:10080 !important;">
            <div style="width:520px;margin:12% auto 0;padding:16px 20px 14px;background-color:#fff;border:1px solid #4d90fe;">
                <div style="margin-bottom:10px;font-size:16px;font-weight:bold;">换课确认</div>
                <div id="swapCourseMsg" style="font-size:14px;line-height:22px;color:#333;"></div>
                <div style="margin-top:18px;text-align:right;">
                    <button type="button" class="btn" id="swapCourseCancel">取消</button>
                    <button type="button" class="btn" id="swapCourseOk"
                            style="margin-left:8px;background-color:#e50112;color:#fff;">确认换课</button>
                </div>
            </div>
        </div>`);
    }

    // 志愿课程在 initSelCourses 里没有 jxbdm（选课序号），但班次列表已经列出了同一门课的
    // 所有班次，可以按组班序号反查它的选课序号；班次列表没打开或已重建时返回 null
    function classListCttId(classNo) {
        const table = document.getElementById(CLASS_LIST_TABLE_ID);
        const tbody = table && table.querySelector('tbody');
        if (!tbody || classNo == null) return null;

        const row = Array.from(tbody.children).find(
            tr => tr.cells && tr.cells.length > 1 && tr.cells[1].textContent.trim() === String(classNo)
        );
        return row ? row.cells[0].textContent.trim() : null;
    }

    // 已录取的课程直接用 jxbdm，志愿课程只能靠组班序号到班次列表里反查
    function selectedCourseCttId(course) {
        if (!course) return null;
        return course.jxbdm || classListCttId(course.classNo);
    }

    // 退课后新班次可能已被占满，这一风险必须先告知用户
    function confirmSwapCourse(courseCode, enrolled) {
        return new Promise(resolve => {
            const cttId = selectedCourseCttId(enrolled);
            const section = [
                cttId ? '选课序号 ' + cttId : '',
                enrolled.classNo ? '班次 ' + enrolled.classNo : '',
                enrolled.teachName,
                enrolled.classTime1,
                enrolled.classRoom1
            ].filter(Boolean).join('　');

            // 志愿课程换课只是改投另一班次的志愿，没有“名额被占用”的风险
            const tip = isVolunteerCourse(enrolled)
                ? '<p style="margin:0;color:#e50112;">该课程尚未录取，撤销志愿不会释放名额，' +
                '志愿能否录取取决于选课结束时的名额分配。是否继续？</p>'
                : '<p style="margin:0;color:#e50112;">若新班次名额在此期间已被他人占用，退课后将无法选中。' +
                '脚本会自动尝试重新选回原班次，但不保证一定成功，是否继续？</p>';

            document.getElementById('swapCourseMsg').innerHTML =
                '<p style="margin:0 0 10px;">课程 <b>' + enrolled.courseName + '</b>（' + courseCode +
                '）' + (isVolunteerCourse(enrolled) ? '已在志愿列表中' : '已经选上') + '，换课会' +
                (isVolunteerCourse(enrolled) ? '<b>先撤销当前志愿</b>再提交新班次' : '<b>先退掉当前班次</b>再选择新班次') + '：</p>' +
                '<p style="margin:0 0 10px;color:#31708f;">当前班次：' + section + '</p>' + tip;

            const field = document.getElementById('swapCourseFld');
            const okButton = document.getElementById('swapCourseOk');
            const cancelButton = document.getElementById('swapCourseCancel');

            const finish = confirmed => {
                okButton.removeEventListener('click', onOk);
                cancelButton.removeEventListener('click', onCancel);
                field.style.display = 'none';
                resolve(confirmed);
            };
            const onOk = () => finish(true);
            const onCancel = () => finish(false);

            okButton.addEventListener('click', onOk);
            cancelButton.addEventListener('click', onCancel);
            field.style.display = '';
        });
    }

    // 后续提交都由脚本驱动，不再走页面原有流程，故先自己确认一次冲突
    function checkCourseConflict(cttId) {
        return new Promise(resolve => {
            $.ajax({
                url: contextPath + '/selectcourse/scConflictCheck',
                type: 'POST',
                dataType: 'json',
                data: { cttId: cttId },
                success: result => resolve(result || {}),
                error: () => resolve({})
            });
        });
    }

    // 退掉当前班次，与 toSSC 页面“删除”按钮使用同一接口。
    // 志愿型选课模式下，志愿列表要靠 cancelType 2 才能撤销，传错就退不掉
    function dropSelectedSection(courseCode, classNo, cancelType) {
        return new Promise(resolve => {
            $.ajax({
                url: contextPath + '/selectcourse/cancelSC',
                type: 'POST',
                dataType: 'json',
                data: { courseCode: courseCode, classNo: classNo, cancelType: cancelType },
                success: result => resolve(result || { success: false, msg: '退课未返回结果' }),
                error: () => resolve({ success: false, msg: '退课请求失败，请刷新页面后重试' })
            });
        });
    }

    // 培养计划页面上的“退课”：培养计划表格里没有班次信息，需要先按课程编号到本学期
    // 选课记录里查到班次号与课程来源，再走与 toSSC 删除按钮相同的接口。
    // 由于两种来源的后果不同，确认文案也要等查到记录后再按来源区分
    function dropEnrolledCourse(courseCode, courseName, link) {
        link.textContent = '退课中...';
        link.style.color = '#999';
        link.style.pointerEvents = 'none';

        const restore = message => {
            if (message) alert(message);
            link.textContent = PLAN_DROP_TEXT;
            link.style.color = '#0066cc';
            link.style.pointerEvents = '';
        };

        const confirmDrop = course => confirm(isVolunteerCourse(course)
            ? '确认撤销“' + courseName + '”的志愿吗？\r\r该课程尚未录取，撤销志愿不会释放名额，重新选课即可恢复志愿。'
            : '确认退掉“' + courseName + '”吗？\r\r退课后该班次的名额会被释放，可能被他人占用，需要重新选课才能恢复。');

        loadSelectedCourses().then(courses => {
            if (!courses) {
                restore('无法获取本学期选课记录，请刷新页面后重试。');
                return;
            }

            const enrolled = courses.find(course => String(course.courseCode) === String(courseCode));
            if (!enrolled) {
                restore('未找到该课程的选课记录，可能已经退课，请刷新页面后重试。');
                return;
            }

            // toSSC 页面对 allowSC 不为 1 的课程同样不显示删除按钮
            if (String(enrolled.allowSC) !== '1') {
                restore('该课程当前不允许退课。');
                return;
            }

            if (!confirmDrop(enrolled)) {
                restore();
                return;
            }

            dropSelectedSection(courseCode, enrolled.classNo, enrolled.cancelType).then(result => {
                if (!result.success) {
                    restore('退课失败：' + (result.msg || '未知错误'));
                    return;
                }

                alert(isVolunteerCourse(enrolled) ? '已撤销志愿！' : '退课成功！');
                // 培养计划表格不会自行更新，这里就地清掉该课程所在学期列的“已选”
                link.parentNode.textContent = '';
                refreshOtherCoursesSection();
            });
        });
    }

    // 验证码只是形式上的校验，任意四位字符都能通过，所以不需要打断用户
    const CAPTCHA_PLACEHOLDER = '0000';

    function isCaptchaRequired(result) {
        return !!(result && result.success && 'F' === result.msg);
    }

    // 页面收到 'F' 后会把验证码输入框插入到“确认”单元格之前，填入占位值重试即可
    function fillCaptchaPlaceholder(aNode) {
        const input = $(aNode).parent().find('.capvalid .capCode');
        if (!input.length) return false;
        input.val(CAPTCHA_PLACEHOLDER);
        return true;
    }

    // 新班次没选上时把原班次选回来：
    // 已经提交过一次的话，页面可能已重建班次列表，只能沿用刚才的提交参数；
    // 否则班次列表还是原样，交给页面自己的提交逻辑去拼装参数
    function restoreOriginalSection(aNode, enrolled, requestData, doSubmit) {
        // 志愿课程没有 jxbdm，需要用组班序号到班次列表里反查原班次的选课序号
        const cttId = selectedCourseCttId(enrolled);
        const report = restored => {
            alert(restored
                ? '换课失败，已自动重新选回原班次（选课序号 ' + cttId + '）。'
                : '换课失败，且未能重新选回原班次，请立即手动重新选课！');

            // 页面上的课程列表还停留在退课后的状态，重新拉取一次
            const refreshCourses = pageWindow.initCourses || pageWindow.initOrgnCourse;
            if (restored && typeof refreshCourses === 'function') {
                refreshCourses.call(pageWindow);
            }
        };

        // 反查不到原班次的选课序号就无法自动选回，只能让用户手动处理
        if (!cttId) {
            report(false);
            return;
        }

        if (!requestData && aNode && document.body.contains(aNode) && typeof doSubmit === 'function') {
            submitNewSection(aNode, cttId, doSubmit, false).then(({ result }) => {
                report(result && result.success && !isCaptchaRequired(result));
            });
            return;
        }

        const baseData = requestData && typeof requestData === 'object'
            ? $.extend({}, requestData, { cttId: cttId })
            : { cttId: cttId, needMaterial: false, capCode: '' };

        const attempt = capCode => $.ajax({
            url: contextPath + '/selectcourse/scSubmit',
            type: 'POST',
            dataType: 'json',
            data: $.extend({}, baseData, { capCode: capCode }),
            success: result => {
                if (isCaptchaRequired(result) && capCode !== CAPTCHA_PLACEHOLDER) {
                    attempt(CAPTCHA_PLACEHOLDER);
                    return;
                }
                report(result && result.success && !isCaptchaRequired(result));
            },
            error: () => alert('换课失败，且重新选回原班次的请求异常，请立即手动重新选课！')
        });

        attempt(baseData.capCode);
    }

    function submitNewSection(aNode, cttId, doSubmit, allowCaptchaRetry = true) {
        return new Promise(resolve => {
            let handled = false;
            const finish = (requestData, submitResult) => {
                if (handled) return;
                handled = true;
                submitWatcher = null;
                resolve({ requestData: requestData, result: submitResult });
            };

            submitWatcher = finish;

            // doSelectSubmit 内部的参数拼装各页面不同（是否选教材、验证码、学科基础等），
            // 优先复用页面自己的实现，取不到时退回页面原有的 selectSubmit
            const submit = typeof doSubmit === 'function' ? doSubmit : originalSelectSubmitRef;
            submit.call(pageWindow, aNode, cttId);

            // 页面流程也可能根本没有提交，交由调用方核对课程最终状态
            setTimeout(() => {
                if (handled) return;
                handled = true;
                submitWatcher = null;
                resolve({ requestData: null, result: null });
            }, SWAP_SETTLE_DELAY);
        }).then(outcome => {
            if (!allowCaptchaRetry || !isCaptchaRequired(outcome.result) || !fillCaptchaPlaceholder(aNode)) {
                return outcome;
            }
            return submitNewSection(aNode, cttId, doSubmit, false);
        });
    }

    // 换课前后都可能有选课冲突提示，此时课程还没退，用户放弃也没有损失
    function confirmConflictWarning(conflictResult) {
        if (!conflictResult || conflictResult.success) return Promise.resolve(true);
        return Promise.resolve(confirm(
            (conflictResult.msg || '选课有冲突') + '\r\r选课有冲突，请确认是否继续提交'
        ));
    }

    function swapCourseSection(aNode, cttId, enrolled, courseCode, doSubmit) {
        confirmSwapCourse(courseCode, enrolled).then(confirmed => {
            if (!confirmed) return;

            checkCourseConflict(cttId).then(conflictResult => {
                confirmConflictWarning(conflictResult).then(proceed => {
                    if (!proceed) return;

                    dropSelectedSection(courseCode, enrolled.classNo, enrolled.cancelType).then(dropResult => {
                        if (!dropResult.success) {
                            alert('退课失败：' + (dropResult.msg || '未知错误') + '，已取消换课。');
                            return;
                        }

                        submitNewSection(aNode, cttId, doSubmit).then(({ requestData, result }) => {
                            if (result && result.success && !isCaptchaRequired(result)) return;

                            loadSelectedCourses().then(courses => {
                                // 提交没走通，但课程可能还在（例如页面根本没有发起提交）
                                const stillSelected = (courses || []).some(
                                    course => String(course.courseCode) === String(courseCode)
                                );
                                if (stillSelected) return;

                                restoreOriginalSection(aNode, enrolled, requestData, doSubmit);
                            });
                        });
                    });
                });
            });
        });
    }

    // 班次列表弹窗在打开时会写入课程编号：#curCourseCode 由各页面共用，
    // #opeCr 在部分页面保存同一个值
    function currentClassListCourseCode() {
        const candidates = [$('#opeCr').val(), $('#curCourseCode').text()];
        return candidates
            .map(value => String(value == null ? '' : value).trim())
            .find(value => /^\d+$/.test(value)) || null;
    }

    // 增强 selectSubmit：课程已选时先退课再选课，未选时保持原有流程
    function enhanceSelectSubmit() {
        if (!pageWindow.selectSubmit || pageWindow.selectSubmitEnhanced) return;

        const originalSelectSubmit = pageWindow.selectSubmit;
        originalSelectSubmitRef = originalSelectSubmit;

        pageWindow.selectSubmit = function (aNode, cttId) {
            const courseCode = currentClassListCourseCode();

            loadSelectedCourses().then(courses => {
                const enrolled = courseCode
                    ? (courses || []).find(course => String(course.courseCode) === String(courseCode))
                    : null;

                if (!enrolled) {
                    originalSelectSubmit.call(pageWindow, aNode, cttId);
                    return;
                }

                // 志愿课程的选课序号要靠班次列表反查，查不到就不能认定是同一班次
                const enrolledCttId = selectedCourseCttId(enrolled);
                if (enrolledCttId && String(enrolledCttId) === String(cttId)) {
                    alert(isVolunteerCourse(enrolled)
                        ? '该班次已经在你的志愿列表中，无需换课。'
                        : '该班次就是当前已选班次，无需换课。');
                    return;
                }
                // 各页面的提交函数都叫 doSelectSubmit，用它可复用各自的参数拼装
                swapCourseSection(aNode, cttId, enrolled, courseCode, pageWindow.doSelectSubmit);
            });
        };

        pageWindow.selectSubmitEnhanced = true;
    }

    // 增强 initOrgnCourse：后端的 initSCByOrgn 只接受单个部门 ID，
    // “全校”选项（id=61）不会返回任何课程，因此在前端遍历所有开课部门并合并渲染
    const ALL_SCHOOL_ORGN_ID = '61';
    const ORGN_QUERY_CONCURRENCY = 6;

    // 查询单个部门的课程；请求失败时返回 null，silent 为真时不弹窗
    function queryOrgnCourses(orgnId, silent) {
        return new Promise((resolve) => {
            $.ajax({
                url: contextPath + '/selectcourse/initSCByOrgn',
                type: 'POST',
                dataType: 'json',
                data: { orgnId: orgnId },
                success: function (result) {
                    resolve(result);
                },
                error: function () {
                    if (!silent) alert('');
                    resolve(null);
                }
            });
        });
    }

    // 取全部开课部门 ID。
    // 页面下拉栏由 getAllOrgnizations({isAcademy:true}) 填充，只会列出 44 个院系，
    // 而 orgnSS 在 isAcademy 非 1 时会返回全部部门（含团委等只出现在隐藏项里的开课单位）。
    // 只按下拉栏聚合会漏掉这些部门的课程，所以这里直接查询完整列表。
    function fetchAllOrgnIds() {
        return new Promise((resolve) => {
            $.ajax({
                url: contextPath + '/common/orgnSS',
                type: 'POST',
                dataType: 'json',
                data: { ordered: false, sortType: 'asc', isAcademy: 0 },
                success: function (result) {
                    if (!result.success || !result.orgnSS) {
                        resolve(null);
                        return;
                    }
                    resolve(result.orgnSS.map(orgn => String(orgn.id))
                        .filter(id => id !== '' && id !== ALL_SCHOOL_ORGN_ID));
                },
                error: function () {
                    resolve(null);
                }
            });
        });
    }

    // 与页面原有的 initOrgnCourse 保持一致的 7 列渲染
    function buildOrgnCourseRows(orgnCourses) {
        const gradeFlag = String(pageWindow.grade || '').match(/\d+/g) || 0;
        const stripArtSort = Number(gradeFlag[0]) > 2024;
        let courseHtml = '';

        for (let i = 0; i < orgnCourses.length; i++) {
            const course = orgnCourses[i];
            let smallSortDesc = course.smallSortDesc == null ? '' : String(course.smallSortDesc);
            if (stripArtSort) {
                smallSortDesc = smallSortDesc.replace('艺术类、', '').replace('艺术类', '');
            }

            courseHtml += '<tr>' +
                '<td><a onclick="selectScope(this)">' + course.courseName + '</a></td>' +
                '<td>' + course.courseCode + '</td>' +
                '<td>' + course.credit + '</td>' +
                '<td><a onclick="showCourseProp(\'' + course.courseCode + '\',2)">课程日历</a></td>' +
                '<td><a onclick="showCourseProp(\'' + course.courseCode + '\',1)">教学大纲</a></td>' +
                '<td>' + course.bigSort + '</td>' +
                '<td>' + course.smallSort + '<span style="color:red;margin-left:5px;">' + smallSortDesc + '</span></td>' +
                '</tr>';
        }

        return courseHtml;
    }

    // 课程列表为空时给出提示，避免表格被静默清空
    function setCourseTblMessage(html) {
        $('#courseTbl tbody').html('<tr><td colspan="7" style="text-align:center;color:#999;">' + html + '</td></tr>');
    }

    // 并发查询所有部门，渲染时保持 orgnSS 返回的部门顺序；无课程的部门自然被跳过
    async function loadAllOrgnCourses(orgnIds) {
        const buckets = new Array(orgnIds.length);
        let cursor = 0;
        let finished = 0;
        let failed = 0;

        setCourseTblMessage('正在加载全部开课单位课程 <span id="orgnProgress">0/' + orgnIds.length + '</span>');

        const worker = async () => {
            while (cursor < orgnIds.length) {
                const index = cursor++;
                const result = await queryOrgnCourses(orgnIds[index], true);
                if (result) {
                    buckets[index] = result.success ? (result.orgnCourses || []) : [];
                } else {
                    failed++;
                }
                finished++;
                const progress = document.getElementById('orgnProgress');
                if (progress) {
                    progress.textContent = finished + '/' + orgnIds.length;
                }
            }
        };

        await Promise.all(Array.from({ length: ORGN_QUERY_CONCURRENCY }, worker));

        const allCourses = [].concat(...buckets.filter(bucket => bucket));
        if (allCourses.length === 0) {
            setCourseTblMessage(failed > 0 ? '查询开课单位课程失败，请重试' : '未查询到任何开课单位的课程');
            return;
        }
        $('#courseTbl tbody').html(buildOrgnCourseRows(allCourses));
    }

    function enhanceInitOrgnCourse() {
        if (!pageWindow.initOrgnCourse || pageWindow.initOrgnCourseEnhanced) return;

        pageWindow.initOrgnCourse = async function () {
            const orgnId = $('#asOrgn').val();

            if (orgnId === ALL_SCHOOL_ORGN_ID) {
                const orgnIds = await fetchAllOrgnIds();
                if (!orgnIds) {
                    alert('获取开课单位列表失败，请重试');
                    return;
                }
                await loadAllOrgnCourses(orgnIds);
                return;
            }

            const result = await queryOrgnCourses(orgnId);
            if (!result) return;

            if (!result.success) {
                alert(result.msg);
                return;
            }

            const courses = result.orgnCourses || [];
            if (courses.length === 0) {
                setCourseTblMessage('未查询到课程');
                return;
            }
            $('#courseTbl tbody').html(buildOrgnCourseRows(courses));
        };

        pageWindow.initOrgnCourseEnhanced = true;
    }

    // 移除首页浮动的“评教指南”图片
    // 该图片由 div-float.js 驱动，会在页面上不停弹跳，点击后跳转到 evalHelp.jsp
    function removeEvalGuide() {
        const tips = document.getElementById('tips');
        if (!tips || !tips.querySelector('a[href*="evalHelp"]')) return;

        tips.remove();

        // 同时停掉 div-float.js 的定时器，否则它会一直对已移除的元素做位移计算
        if (pageWindow.interval) {
            pageWindow.clearInterval(pageWindow.interval);
            pageWindow.interval = null;
        }
    }

    removeEvalGuide();

    // 以下增强仅用于选课页面，首页没有相应函数，既无需执行也无需轮询
    if (sitePath().startsWith('/dhu/selectcourse/')) {
        // 侧边栏不依赖页面表格，直接挂载，避免个别页面没有表格时被一起跳过
        addCourseTableSidebar();

        // 等待表格加载完成后初始化
        waitForElement('table tbody', init);

        // 增强选课手册按钮 - 使用轮询检测函数是否可用
        const tryEnhance = () => {
            if (pageWindow.showScmTbl && !pageWindow.showScmTblEnhanced) {
                enhanceHandbookButton();
            }
            if (pageWindow.selectScope && !pageWindow.selectScopeEnhanced) {
                enhanceSelectScope();
            }
            if (pageWindow.selectSubmit && !pageWindow.selectSubmitEnhanced) {
                enhanceSelectSubmit();
            }
            if (pageWindow.initOrgnCourse && !pageWindow.initOrgnCourseEnhanced) {
                enhanceInitOrgnCourse();
            }
            if (!pageWindow.showScmTblEnhanced || !pageWindow.selectScopeEnhanced ||
                (pageWindow.selectSubmit && !pageWindow.selectSubmitEnhanced)) {
                setTimeout(tryEnhance, 200);
            }
        };

        // 开始尝试增强
        tryEnhance();
    }
})();
