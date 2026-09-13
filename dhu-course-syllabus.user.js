// ==UserScript==
// @name         东华大学本科教务管理系统选课显示增强
// @namespace    http://tampermonkey.net/
// @version      2.14
// @description  1. 点击课程名称可查看教学大纲 2. 选课手册显示最新版本(2019-2026级) 3. 已修/已选/已通过课程可查看班次列表 4. 移除首页浮动的评教指南 5. “全校”选项可汇总显示所有学院的课程 6. 兼容校外 webvpn 代理访问 7. 简化文化素质类课程数量提示
// @author       NullWinters
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toSH*
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toSCC*
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toSelectByOrgn*
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toOEC*
// @match        https://jwgl.dhu.edu.cn/dhu/studenthome.jsp*
// @match        https://webproxy.dhu.edu.cn/https/*/dhu/selectcourse/toSH*
// @match        https://webproxy.dhu.edu.cn/https/*/dhu/selectcourse/toSCC*
// @match        https://webproxy.dhu.edu.cn/https/*/dhu/selectcourse/toSelectByOrgn*
// @match        https://webproxy.dhu.edu.cn/https/*/dhu/selectcourse/toOEC*
// @match        https://webproxy.dhu.edu.cn/https/*/dhu/studenthome.jsp*
// @grant        GM_xmlhttpRequest
// @connect      jw.dhu.edu.cn
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // 校外通过 webvpn 访问时，URL 形如 https://webproxy.dhu.edu.cn/https/<token>/dhu/xxx，
    // 代理会在页面中注入 vpn_rewrite_url，可据此判断当前是否处于代理环境
    function isWebVpn() {
        return typeof pageWindow.vpn_rewrite_url === 'function';
    }

    // 取站点内路径，即去掉 webvpn 的 /https/<token> 前缀，便于与直连环境使用同一套判断
    function sitePath() {
        const matched = window.location.pathname.match(/\/dhu\/.*$/);
        return matched ? matched[0] : window.location.pathname;
    }

    // 代理环境下需调用页面内的 fetch：vpn 脚本会把站外地址改写为同源代理地址，不受跨域限制；
    // 脚本沙箱中的 fetch 不会被改写，直连环境则使用 GM_xmlhttpRequest 绕过跨域
    function fetchExternalText(url, onload, onerror) {
        if (isWebVpn()) {
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

    // 代理环境下站外链接无法直连，需改写为代理地址后才能访问
    function toAccessibleUrl(url) {
        if (!isWebVpn()) return url;
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
                <button type="button" data-dismiss="modal" class="btn">取消</button>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    // 定义 showCourseProp 函数
    function defineShowCourseProp() {
        if (typeof pageWindow.showCourseProp !== 'function') {
            pageWindow.showCourseProp = function(courseCode, type) {
                $.viewCourseMaterial({
                    courseCode: courseCode,
                    type: type,
                    tagId: 'onlineView',
                    contextPath: '/dhu'
                });
            };
        }
    }

    // 为课程名称添加点击事件
    function addCourseNameClickEvents() {
        const table = document.querySelector('table');
        if (!table) return;

        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            // 课程名称在第3列（索引2）
            if (cells.length > 2) {
                const courseNameCell = cells[2];
                const courseCodeCell = cells[1];

                // 检查是否已经有点击事件（通过检查是否包含链接或已标记）
                if (!courseNameCell.querySelector('a') && !courseNameCell.dataset.courseBind && courseCodeCell.textContent.trim()) {
                    const courseName = courseNameCell.textContent.trim();
                    const courseCode = courseCodeCell.textContent.trim();

                    // 跳过分类标题行（如"必修课"、"选修课"等）
                    // 同时跳过纯数字单元格（学分类）：部分页面第 3 列并非课程名称
                    if (courseName && !/^[\d.]+$/.test(courseName) && !courseName.includes('要求学分') && !courseName.includes('获得学分') && courseCode.match(/^\d+$/)) {
                        courseNameCell.dataset.courseBind = 'true';
                        courseNameCell.style.cursor = 'pointer';
                        courseNameCell.style.color = '#0066cc';
                        courseNameCell.style.textDecoration = 'underline';
                        courseNameCell.title = '点击查看教学大纲';

                        courseNameCell.addEventListener('click', function() {
                            pageWindow.showCourseProp(courseCode, 1);
                        });
                    }
                }
            }
        });
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

    // 初始化
    function init() {
        addModal();
        defineShowCourseProp();
        addCourseNameClickEvents();
        removeNoticeButton();
        removeHonorsCourses();
        simplifySccNotice();

        // 监听DOM变化（处理动态加载内容）
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    addCourseNameClickEvents();
                    removeHonorsCourses();
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
            function(html) {
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
                        function(html) {
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
                        function() {
                            completed++;
                            if (completed === remainingPages.length) {
                                allHandbooks.sort((a, b) => parseInt(b.year) - parseInt(a.year));
                                callback(allHandbooks);
                            }
                        }
                    );
                });
            },
            function() {
                console.error('获取选课手册失败');
                callback([]);
            }
        );
    }

    // 增强选课手册按钮
    function enhanceHandbookButton() {
        const originalShowScmTbl = pageWindow.showScmTbl;
        if (!originalShowScmTbl || pageWindow.showScmTblEnhanced) return;

        pageWindow.showScmTbl = function() {
            // 先调用原函数显示侧边栏
            originalShowScmTbl.call(pageWindow);

            // 延迟获取最新手册并替换内容（等待原函数加载完成）
            setTimeout(function() {
                fetchLatestHandbooks(function(handbooks) {
                    if (handbooks.length === 0) return;

                    const scmList = document.getElementById('scmList');
                    if (!scmList) return;

                    // 清空原有内容
                    scmList.innerHTML = '';

                    // 添加新的手册链接
                    handbooks.forEach(function(handbook) {
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

        pageWindow.selectScope = function(aNode) {
            closeFailureMsg();
            
            // 根据页面类型获取课程代码
            let courseCode;
            if (isCourseNamePage) {
                // toSCC/toSelectByOrgn/toOEC页面：课程代码在课程名称的下一个td中
                courseCode = $(aNode).parent().next('td').html();
            } else {
                // toSH页面：课程代码在链接文本中
                courseCode = $(aNode).html();
                // 高亮选中的行
                $('#tsCoursesTbl tr.choseTr').removeClass('choseTr');
                $($(aNode).parents('tr')[0]).addClass('choseTr');
            }

            $.ajax({
                url: contextPath + '/selectcourse/accessJudge',
                type: 'POST',
                dataType: 'json',
                data: { courseCode: courseCode },
                async: false,
                success: function(result) {
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
                error: function() {
                    alert('');
                }
            });
        };

        pageWindow.selectScopeEnhanced = true;
    }

    // 增强 initOrgnCourse：后端的 initSCByOrgn 只接受单个学院 ID，
    // “全校”选项（id=61）不会返回任何课程，因此在前端遍历下拉框中所有学院并合并渲染
    const ALL_SCHOOL_ORGN_ID = '61';
    const ORGN_QUERY_CONCURRENCY = 6;

    // 查询单个学院的课程；请求失败时弹窗提示并返回 null
    function queryOrgnCourses(orgnId) {
        return new Promise((resolve) => {
            $.ajax({
                url: contextPath + '/selectcourse/initSCByOrgn',
                type: 'POST',
                dataType: 'json',
                data: { orgnId: orgnId },
                success: function(result) {
                    resolve(result);
                },
                error: function() {
                    alert('');
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

    // 并发查询所有学院，渲染时保持下拉栏中的学院顺序
    async function loadAllOrgnCourses(orgnIds) {
        const buckets = new Array(orgnIds.length);
        let cursor = 0;
        let finished = 0;

        setCourseTblMessage('正在加载全部学院课程 <span id="orgnProgress">0/' + orgnIds.length + '</span>');

        const worker = async () => {
            while (cursor < orgnIds.length) {
                const index = cursor++;
                const result = await queryOrgnCourses(orgnIds[index]);
                if (result) {
                    buckets[index] = result.success ? (result.orgnCourses || []) : [];
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
            setCourseTblMessage('未查询到任何学院的课程');
            return;
        }
        $('#courseTbl tbody').html(buildOrgnCourseRows(allCourses));
    }

    function enhanceInitOrgnCourse() {
        if (!pageWindow.initOrgnCourse || pageWindow.initOrgnCourseEnhanced) return;

        pageWindow.initOrgnCourse = async function() {
            const orgnId = $('#asOrgn').val();

            if (orgnId === ALL_SCHOOL_ORGN_ID) {
                // 收集下拉栏中的所有学院（排除空白选项与“全校”自身）
                const orgnIds = $('#asOrgn option').map(function() {
                    return this.value;
                }).get().filter(value => value !== '' && value !== ALL_SCHOOL_ORGN_ID);
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
            if (pageWindow.initOrgnCourse && !pageWindow.initOrgnCourseEnhanced) {
                enhanceInitOrgnCourse();
            }
            if (!pageWindow.showScmTblEnhanced || !pageWindow.selectScopeEnhanced) {
                setTimeout(tryEnhance, 200);
            }
        };

        // 开始尝试增强
        tryEnhance();
    }
})();
