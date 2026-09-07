const NTUBScraper = require('./ntubScraper');
const SimpleOCR = require('./simpleOCR');

class ClassScheduleScraper extends NTUBScraper {
    constructor() {
        super();
    }

    /**
     * 獲取學期課表
     * @param {string} sessionToken - 登入會話令牌
     * @param {string} semester - 學期，例如：'1122' 表示 112 學年度第 2 學期
     * @returns {Promise<Object>} 包含課表資料的物件
     */
    async getClassSchedule(sessionToken, semester = '') {
        const session = this.sessions.get(sessionToken);
        if (!session) {
            throw new Error('無效的會話，請先登入');
        }

        const { page } = session;
        
        try {
            console.log('📅 正在獲取課表資料...');
            
            // 直接導航到課表頁面
            console.log('🌐 正在導航到課表頁面...');
            await page.goto('https://ntcbadm1.ntub.edu.tw/STDWEB/Sel_Student.aspx', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            console.log('🔍 檢查是否成功進入課表頁面...');
            
            // 檢查是否成功進入課表頁面
            const pageTitle = await page.title();
            console.log('📄 頁面標題:', pageTitle);
            
            // 等待實際課表表格載入
            console.log('⏳ 等待課表表格 #bgBase 載入...');
            await page.waitForSelector('#bgBase', { timeout: 15000 });

            // 解析課表資料
            const scheduleData = await page.evaluate(() => {
                console.log('🔄 開始解析課表資料（#bgBase 課表）...');
                const schedule = [];

                const table = document.querySelector('#bgBase');
                if (!table) {
                    console.error('❌ 找不到 id="bgBase" 的課表表格');
                    return [];
                }

                const rows = table.querySelectorAll('tr');
                console.log('📝 找到的行數:', rows.length);

                if (rows.length <= 1) {
                    return [];
                }

                // 節次對應表，依照學校實際節次可再調整
                const periodCodes = [
                    '1',  // 第一節
                    '2',  // 第二節
                    '3',  // 第三節
                    '4',  // 第四節
                    '5',  // 第五節
                    '6',  // 第六節
                    '7',  // 第七節
                    '8',  // 第八節
                    'A',  // 第九節
                    'B',  // 第十節
                    'C',  // 第十一節
                    'D',  // 第十二節
                    'E',  // 第十三節
                    'F'   // 第十四節
                ];

                // 從第 2 列開始（index 1）為實際課表內容
                for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
                    const row = rows[rowIndex];
                    const cells = row.querySelectorAll('td');
                    if (cells.length < 8) {
                        continue;
                    }

                    const period = periodCodes[rowIndex - 1] || '';

                    // 第 0 欄是節次說明，1~7 欄是星期一到星期日
                    for (let colIndex = 1; colIndex <= 7; colIndex++) {
                        const cell = cells[colIndex];
                        if (!cell) continue;

                        const rawText = (cell.innerText || '').trim();
                        if (!rawText) continue; // 沒課

                        const lines = rawText
                            .split(/\n|<br\s*\/?>/i)
                            .map(t => t.trim())
                            .filter(t => t.length > 0);

                        if (lines.length === 0) continue;

                        // 目前頁面一格通常只有一門課：
                        // 行 0: 課程名稱
                        // 行 1: 老師
                        // 行 2: 教室
                        const courseName = lines[0] || '';
                        const teacher = lines[1] || '';
                        const classroom = lines[2] || '';

                        const course = {
                            courseCode: '',
                            courseName: courseName,
                            credit: 0,
                            required: null,
                            teacher: teacher,
                            period: period,
                            dayOfWeek: colIndex, // 1=一, 2=二, ... 7=日
                            locations: classroom ? [classroom] : []
                        };

                        console.log('📚 解析到課程:', course.courseName, '星期', colIndex, '節次', period);
                        schedule.push(course);
                    }
                }

                console.log('✅ 課表解析完成，共找到', schedule.length, '筆節次資料');
                return schedule;
            });

            console.log(`✅ 成功獲取 ${scheduleData.length} 筆課表資料（節次）`);
            return {
                success: true,
                data: scheduleData
            };
            
        } catch (error) {
            console.error('❌ 獲取課表失敗:', error);
            return {
                success: false,
                message: '獲取課表失敗: ' + error.message
            };
        }
    }

    /**
     * 獲取當前學期
     * @param {string} sessionToken - 登入會話令牌
     * @returns {Promise<Object>} 包含學期資訊的物件
     */
    async getCurrentSemester(sessionToken) {
        const session = this.sessions.get(sessionToken);
        if (!session) {
            throw new Error('無效的會話，請先登入');
        }

        const { page } = session;
        
        try {
            console.log('🌐 正在獲取學期資訊...');
            
            // 嘗試從多個可能的頁面獲取學期資訊
            const urlsToTry = [
                '/student/default.aspx',
                '/student/class_schedule.aspx',
                '/student/student.aspx'
            ];
            
            let semesterInfo = null;
            
            for (const url of urlsToTry) {
                try {
                    console.log(`🔍 嘗試從 ${url} 獲取學期資訊...`);
                    await page.goto(`${this.baseUrl}${url}`, {
                        waitUntil: 'domcontentloaded',
                        timeout: 10000
                    });
                    
                    // 從頁面中提取學期資訊
                    semesterInfo = await page.evaluate(() => {
                        // 先嘗試幾個具體的 selector
                        const selectors = [
                            '#lbl_semester',
                            '.semester-info',
                            '.header-info',
                            'span[style*="font-size:12pt"]'
                        ];

                        const tryParse = (text) => {
                            if (!text) return null;
                            // 嘗試匹配多種格式的學期資訊
                            const patterns = [
                                /([0-9]{3})學年度第([1-4])學期/, // 112學年度第2學期
                                /([0-9]{3})-([1-4])/,             // 112-2
                                /([0-9]{3})([1-4])/,              // 1122
                            ];
                            for (const pattern of patterns) {
                                const match = text.match(pattern);
                                if (match) {
                                    const year = match[1];
                                    const term = match[2];
                                    return {
                                        year,
                                        term,
                                        fullText: `${year}學年度第${term}學期`
                                    };
                                }
                            }
                            return null;
                        };

                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element) {
                                const text = element.innerText || '';
                                const parsed = tryParse(text);
                                if (parsed) return parsed;
                            }
                        }

                        // 如果前面的 selector 沒找到，就在整個頁面搜尋包含「學年度」的節點
                        const candidates = Array.from(document.querySelectorAll('div, span, td'));
                        for (const el of candidates) {
                            const text = (el.innerText || '').trim();
                            if (!text || !text.includes('學年度')) continue;
                            const parsed = tryParse(text);
                            if (parsed) return parsed;
                        }

                        // 最後退回整個 body 文字試一次
                        const bodyText = document.body ? (document.body.innerText || '') : '';
                        const parsedBody = tryParse(bodyText);
                        if (parsedBody) return parsedBody;

                        return null;
                    });
                    
                    if (semesterInfo) {
                        console.log('✅ 成功獲取學期資訊:', semesterInfo);
                        break;
                    }
                } catch (error) {
                    console.warn(`⚠️ 從 ${url} 獲取學期資訊失敗:`, error.message);
                    continue;
                }
            }

            if (!semesterInfo) {
                // 如果無法自動獲取學期，使用當前日期推斷
                console.warn('⚠️ 無法從頁面獲取學期資訊，嘗試使用當前日期推斷...');
                const now = new Date();
                const year = now.getFullYear() - 1911; // 轉換為民國年
                const month = now.getMonth() + 1;
                const term = month >= 2 && month <= 7 ? '2' : '1'; // 2-7月為第2學期，其他為第1學期
                
                semesterInfo = {
                    year: year.toString(),
                    term: term,
                    fullText: `${year}學年度第${term}學期`
                };
                
                console.log('ℹ️ 使用推斷的學期資訊:', semesterInfo);
            }

            return {
                success: true,
                data: {
                    semester: `${semesterInfo.year}${semesterInfo.term}`, // 1122
                    year: semesterInfo.year,
                    term: semesterInfo.term,
                    displayText: semesterInfo.fullText
                }
            };
            
        } catch (error) {
            console.error('❌ 獲取學期資訊失敗:', error);
            return {
                success: false,
                message: '獲取學期資訊失敗: ' + error.message
            };
        }
    }

    /**
     * 將課表資料轉換為資料庫格式
     * @param {Array} scheduleData - 課表資料陣列
     * @param {string} semester - 學期，例如：'1122'
     * @param {number} userId - 使用者ID
     * @returns {Array} 轉換後的課表資料
     */
    formatScheduleForDatabase(scheduleData, semester, userId) {
        return scheduleData.map(course => {
            // 將節次轉換為時間範圍（依北商校務系統公告之節次時間）
            const parseTime = (period) => {
                const periodMap = {
                    '1': { start: '08:10', end: '09:00' },
                    '2': { start: '09:10', end: '10:00' },
                    '3': { start: '10:10', end: '11:00' },
                    '4': { start: '11:10', end: '12:00' },
                    'N': { start: '12:10', end: '13:00' }, // 午休時間
                    '5': { start: '13:30', end: '14:20' },
                    '6': { start: '14:25', end: '15:15' },
                    '7': { start: '15:25', end: '16:15' },
                    '8': { start: '16:20', end: '17:10' },
                    'A': { start: '17:15', end: '18:05' },
                    'B': { start: '18:10', end: '19:00' },
                    'C': { start: '18:30', end: '19:15' },
                    'D': { start: '19:20', end: '20:05' },
                    'E': { start: '20:15', end: '21:00' },
                    'F': { start: '21:05', end: '21:50' },
                };

                const periodInfo = periodMap[period] || { start: '00:00', end: '00:00' };
                return {
                    startTime: periodInfo.start,
                    endTime: periodInfo.end
                };
            };

            const timeInfo = parseTime(course.period);
            
            return {
                user_id: userId,
                course_code: course.courseCode,
                course_name: course.courseName,
                teacher: course.teacher,
                classroom: course.locations[0] || '',
                day_of_week: course.dayOfWeek,
                start_time: timeInfo.startTime,
                end_time: timeInfo.endTime,
                credit: course.credit,
                semester: semester,
                created_at: new Date(),
                updated_at: new Date()
            };
        });
    }
}

module.exports = ClassScheduleScraper;
