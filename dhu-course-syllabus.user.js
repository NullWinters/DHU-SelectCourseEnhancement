// ==UserScript==
// @name         东华大学本科教务管理系统选课显示增强
// @namespace    http://tampermonkey.net/
// @version      2.11
// @description  1. 点击课程名称可查看教学大纲 2. 选课手册显示最新版本(2019-2026级) 3. 已修/已选/已通过课程可查看班次列表 4. 移除首页浮动的评教指南
// @author       NullWinters
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toSH*
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toSCC*
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toSelectByOrgn*
// @match        https://jwgl.dhu.edu.cn/dhu/selectcourse/toOEC*
// @match        https://jwgl.dhu.edu.cn/dhu/studenthome.jsp*
// @grant        GM_xmlhttpRequest
// @connect      jw.dhu.edu.cn
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

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
                    if (courseName && !courseName.includes('要求学分') && !courseName.includes('获得学分') && courseCode.match(/^\d+$/)) {
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

    // 删除荣誉课程表格
    function removeHonorsCourses() {
        const rows = document.querySelectorAll('tr');
        rows.forEach(row => {
            if (row.textContent.includes('荣誉课程')) {
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

        // 监听DOM变化（处理动态加载内容）
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    addCourseNameClickEvents();
                    removeHonorsCourses();
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
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://jw.dhu.edu.cn/9960/list1.htm',
            onload: function(response) {
                const totalPages = getTotalPages(response.responseText);
                const firstPageHandbooks = parseHandbooksFromHTML(response.responseText);

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
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `https://jw.dhu.edu.cn/9960/list${pageNum}.htm`,
                        onload: function(res) {
                            const pageHandbooks = parseHandbooksFromHTML(res.responseText);
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
                        onerror: function() {
                            completed++;
                            if (completed === remainingPages.length) {
                                allHandbooks.sort((a, b) => parseInt(b.year) - parseInt(a.year));
                                callback(allHandbooks);
                            }
                        }
                    });
                });
            },
            onerror: function() {
                console.error('获取选课手册失败');
                callback([]);
            }
        });
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
                        link.href = handbook.url;
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
            window.location.pathname.endsWith(page)
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
    if (window.location.pathname.startsWith('/dhu/selectcourse/')) {
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
            if (!pageWindow.showScmTblEnhanced || !pageWindow.selectScopeEnhanced) {
                setTimeout(tryEnhance, 200);
            }
        };

        // 开始尝试增强
        tryEnhance();
    }
})();
