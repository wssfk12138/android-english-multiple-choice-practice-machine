// 与 Android 原生层 EsqArchive.java 的常量保持一致，由
// tests/question-bank-limits-contract.mjs 双向核对。
export const MAX_ESQ_MIB = 2048
export const MAX_ESQ_BYTES = MAX_ESQ_MIB * 1024 * 1024
export const MAX_ESQ_ENTRIES = 10000
export const MAX_ZIP_COMPRESSION_RATIO = 250
export const MAX_SINGLE_JSON_BYTES = 64 * 1024 * 1024
export const MAX_TOTAL_JSON_BYTES = 256 * 1024 * 1024
