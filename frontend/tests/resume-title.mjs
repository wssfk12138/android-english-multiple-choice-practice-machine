import assert from 'node:assert/strict'
import {resumeTitle} from '../src/resume-title.ts'
for(const [mode, identity, expected] of [
  ["paper", {"year":2016,"paper":"2016年考研英语一真题","unit":"阅读理解 Text 1"}, "2016 年 · 考研英语一真题"],
  ["random", {"year":2016,"paper":"2016年考研英语一真题","unit":"2016 年 · 阅读理解 Text 1"}, "2016 年 · 考研英语一真题 · 阅读理解 Text 1"],
  ["random", {"year":2016,"paper":"2016年考研英语二真题","unit":"阅读理解 Text 1"}, "2016 年 · 考研英语二真题 · 阅读理解 Text 1"],
  ["paper", {"year":2016,"paper":"练习12016套"}, "2016 年 · 练习12016套"],
  ["paper", {"year":2016,"paper":"真题"}, "2016 年 · 真题"],
  ["paper", {"year":2016,"paper":"2016年真题 2016年"}, "2016 年 · 真题"],
  ["random", {"paper":"模拟套卷A","unit":"Text 2"}, "模拟套卷A · Text 2"]
]) assert.equal(resumeTitle(mode,identity),expected)
console.log('PASS resume titles: exact year, paper identity, units and suites')
