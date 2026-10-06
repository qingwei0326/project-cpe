/*
 * @Author: 1orz cloudorzi@gmail.com
 * @Date: 2025-11-23 03:05:36
 * @LastEditors: 1orz cloudorzi@gmail.com
 * @LastEditTime: 2025-12-13 12:45:08
 * @FilePath: /udx710-backend/frontend/src/utils/carriers.ts
 * @Description: 
 * 
 * Copyright (c) 2025 by 1orz, All Rights Reserved. 
 */
// 运营商信息数据库 (MCC-MNC 映射)
export interface CarrierInfo {
  mccMnc: string
  mcc: string
  mnc: string
  operatorCn: string // 中文名称
  operatorEn: string // 英文名称
  brand: string // 品牌
  status: string // 状态
  technology?: string // 技术标准
  notes?: string // 备注
}

// 中国大陆运营商映射表
export const CHINA_CARRIERS: CarrierInfo[] = [
  {
    mccMnc: '46000',
    mcc: '460',
    mnc: '00',
    operatorCn: '中国移动',
    operatorEn: 'China Mobile',
    brand: '中国移动',
    status: '营运中',
    technology: 'GSM 900 / GSM 1800 / TD-SCDMA 1880 / TD-SCDMA 2010 / TD-LTE 1800/2300/2600',
  },
  {
    mccMnc: '46001',
    mcc: '460',
    mnc: '01',
    operatorCn: '中国联通',
    operatorEn: 'China Unicom',
    brand: '中国联通',
    status: '营运中',
    technology: 'GSM 900 / GSM 1800 / UMTS 2100 / TD-LTE 2300/2600 / FDD-LTE 1800/2100',
  },
  {
    mccMnc: '46002',
    mcc: '460',
    mnc: '02',
    operatorCn: '中国移动',
    operatorEn: 'China Mobile',
    brand: '中国移动',
    status: '营运中',
    technology: 'GSM 900 / GSM 1800 / TD-SCDMA 1880 / TD-SCDMA 2010',
  },
  {
    mccMnc: '46003',
    mcc: '460',
    mnc: '03',
    operatorCn: '中国电信',
    operatorEn: 'China Telecom',
    brand: '中国电信',
    status: '营运中',
    technology: 'CDMA2000 800 / CDMA2000 2100 / TD-LTE 2300/2600 / FDD-LTE 1800/2100 / EV-DO / eHRPD',
  },
  {
    mccMnc: '46005',
    mcc: '460',
    mnc: '05',
    operatorCn: '中国电信',
    operatorEn: 'China Telecom',
    brand: '中国电信',
    status: '营运中',
  },
  {
    mccMnc: '46006',
    mcc: '460',
    mnc: '06',
    operatorCn: '中国联通',
    operatorEn: 'China Unicom',
    brand: '中国联通',
    status: '营运中',
    technology: 'GSM 900 / GSM 1800 / UMTS 2100',
  },
  {
    mccMnc: '46007',
    mcc: '460',
    mnc: '07',
    operatorCn: '中国移动',
    operatorEn: 'China Mobile',
    brand: '中国移动',
    status: '营运中',
    technology: 'GSM 900 / GSM 1800 / TD-SCDMA 1880 / TD-SCDMA 2010',
  },
  {
    mccMnc: '46008',
    mcc: '460',
    mnc: '08',
    operatorCn: '中国移动',
    operatorEn: 'China Mobile',
    brand: '中国移动',
    status: '营运中',
  },
  {
    mccMnc: '46009',
    mcc: '460',
    mnc: '09',
    operatorCn: '中国联通',
    operatorEn: 'China Unicom',
    brand: '中国联通',
    status: '营运中',
  },
  {
    mccMnc: '46011',
    mcc: '460',
    mnc: '11',
    operatorCn: '中国电信',
    operatorEn: 'China Telecom',
    brand: '中国电信',
    status: '营运中',
    technology: 'CDMA2000 800 / CDMA2000 2100 / TD-LTE 2300/2600 / FDD-LTE 1800/2100 / EV-DO / eHRPD',
  },
  {
    mccMnc: '46015',
    mcc: '460',
    mnc: '15',
    operatorCn: '中国广电',
    operatorEn: 'China Broadnet',
    brand: '中国广电',
    status: '营运中',
    technology: 'LTE 1800 / LTE 900 / TD-LTE 1900 / TD-LTE 2300 / 5G 700 / 5G 2500',
  },
  {
    mccMnc: '46016',
    mcc: '460',
    mnc: '16',
    operatorCn: '中国广电',
    operatorEn: 'China Broadnet',
    brand: '中国广电',
    status: '营运中',
    technology: '5G 700 / 5G 2500',
  },
  {
    mccMnc: '46020',
    mcc: '460',
    mnc: '20',
    operatorCn: '中国铁通',
    operatorEn: 'China Tietong',
    brand: '中国铁通',
    status: '营运中',
    technology: 'GSM-R',
  },
]

// 中国香港 / 中国澳门 / 中国台湾 主要运营商
export const GREATER_CHINA_CARRIERS: CarrierInfo[] = [
  { mccMnc: '45400', mcc: '454', mnc: '00', operatorCn: '中国香港 CSL', operatorEn: 'CSL', brand: 'CSL', status: '营运中' },
  { mccMnc: '45403', mcc: '454', mnc: '03', operatorCn: '中国香港 3 HK', operatorEn: '3 Hong Kong', brand: '3HK', status: '营运中' },
  { mccMnc: '45404', mcc: '454', mnc: '04', operatorCn: '中国香港 1010', operatorEn: 'One2Free', brand: '1010', status: '营运中' },
  { mccMnc: '45406', mcc: '454', mnc: '06', operatorCn: '中国香港 SmarTone', operatorEn: 'SmarTone', brand: 'SmarTone', status: '营运中' },
  { mccMnc: '45410', mcc: '454', mnc: '10', operatorCn: '中国香港 中国移动香港', operatorEn: 'China Mobile HK', brand: 'CMHK', status: '营运中' },
  { mccMnc: '45501', mcc: '455', mnc: '01', operatorCn: '中国澳门 CTM', operatorEn: 'CTM', brand: 'CTM', status: '营运中' },
  { mccMnc: '45502', mcc: '455', mnc: '02', operatorCn: '中国澳门 3 Macau', operatorEn: '3 Macau', brand: '3Macau', status: '营运中' },
  { mccMnc: '46601', mcc: '466', mnc: '01', operatorCn: '中国台湾 中华电信', operatorEn: 'Chunghwa Telecom', brand: '中华电信', status: '营运中' },
  { mccMnc: '46605', mcc: '466', mnc: '05', operatorCn: '中国台湾 中华电信', operatorEn: 'Chunghwa Telecom', brand: '中华电信', status: '营运中' },
  { mccMnc: '46692', mcc: '466', mnc: '92', operatorCn: '中国台湾 中华电信', operatorEn: 'Chunghwa Telecom', brand: '中华电信', status: '营运中' },
  { mccMnc: '46697', mcc: '466', mnc: '97', operatorCn: '中国台湾 台湾大哥大', operatorEn: 'Taiwan Mobile', brand: '台湾大哥大', status: '营运中' },
  { mccMnc: '46699', mcc: '466', mnc: '99', operatorCn: '中国台湾 远传电信', operatorEn: 'FarEasTone', brand: '远传电信', status: '营运中' },
  { mccMnc: '46688', mcc: '466', mnc: '88', operatorCn: '中国台湾 亚太电信', operatorEn: 'Asia Pacific Telecom', brand: '亚太电信', status: '营运中' },
]

/**
 * 常见国际漫游运营商（紧凑表：[MCCMNC, 中文, 英文]）
 * 覆盖高频出境目的地，未收录的走别名兜底或原样显示。
 */
const INTERNATIONAL_ENTRIES: [string, string, string][] = [
  ['44010', '日本 NTT docomo', 'NTT docomo'],
  ['44020', '日本 SoftBank', 'SoftBank'],
  ['44051', '日本 au (KDDI)', 'au by KDDI'],
  ['44000', '日本 NTT docomo', 'NTT docomo'],
  ['45005', '韩国 SK Telecom', 'SK Telecom'],
  ['45006', '韩国 KT', 'KT'],
  ['45008', '韩国 LG U+', 'LG U+'],
  ['52501', '新加坡 Singtel', 'Singtel'],
  ['52502', '新加坡 StarHub', 'StarHub'],
  ['52503', '新加坡 M1', 'M1'],
  ['50212', '马来西亚 Maxis', 'Maxis'],
  ['50213', '马来西亚 Celcom', 'Celcom'],
  ['50216', '马来西亚 Digi', 'Digi'],
  ['52001', '泰国 AIS', 'AIS'],
  ['52003', '泰国 TrueMove H', 'TrueMove H'],
  ['52005', '泰国 dtac', 'dtac'],
  ['51001', '印尼 Telkomsel', 'Telkomsel'],
  ['51010', '印尼 Telkomsel', 'Telkomsel'],
  ['51502', '菲律宾 Globe', 'Globe'],
  ['51503', '菲律宾 Smart', 'Smart'],
  ['45204', '越南 Viettel', 'Viettel'],
  ['45202', '越南 Vinaphone', 'Vinaphone'],
  ['40401', '印度 Airtel', 'Bharti Airtel'],
  ['40420', '印度 Jio', 'Reliance Jio'],
  ['23415', '英国 Vodafone', 'Vodafone UK'],
  ['23410', '英国 O2', 'O2 UK'],
  ['23430', '英国 EE', 'EE'],
  ['26201', '德国 Telekom', 'Deutsche Telekom'],
  ['26202', '德国 Vodafone', 'Vodafone DE'],
  ['26203', '德国 O2', 'Telefónica DE'],
  ['20801', '法国 Orange', 'Orange FR'],
  ['20810', '法国 SFR', 'SFR'],
  ['20815', '法国 Free', 'Free Mobile'],
  ['22201', '意大利 TIM', 'TIM'],
  ['22210', '意大利 Vodafone', 'Vodafone IT'],
  ['21401', '西班牙 Movistar', 'Movistar'],
  ['21407', '西班牙 Orange', 'Orange ES'],
  ['20404', '荷兰 KPN', 'KPN'],
  ['20408', '荷兰 Vodafone', 'Vodafone NL'],
  ['310260', '美国 T-Mobile', 'T-Mobile US'],
  ['310410', '美国 AT&T', 'AT&T'],
  ['311480', '美国 Verizon', 'Verizon'],
  ['302220', '加拿大 Telus', 'Telus'],
  ['302370', '加拿大 Rogers', 'Rogers'],
  ['50501', '澳洲 Telstra', 'Telstra'],
  ['50502', '澳洲 Optus', 'Optus'],
  ['50503', '澳洲 Vodafone', 'Vodafone AU'],
  ['53001', '新西兰 Spark', 'Spark NZ'],
  ['53005', '新西兰 Vodafone', 'One NZ'],
  ['72402', '巴西 Claro', 'Claro BR'],
  ['72405', '巴西 Vivo', 'Vivo'],
  ['72207', '阿根廷 Claro', 'Claro AR'],
  ['65501', '南非 Vodacom', 'Vodacom'],
  ['65510', '南非 MTN', 'MTN SA'],
  ['60201', '埃及 Orange', 'Orange EG'],
  ['60202', '埃及 Vodafone', 'Vodafone EG'],
  ['42403', '阿联酋 du', 'du'],
  ['42402', '阿联酋 Etisalat', 'Etisalat'],
  ['25001', '俄罗斯 MTS', 'MTS'],
  ['25002', '俄罗斯 MegaFon', 'MegaFon'],
  ['25099', '俄罗斯 Beeline', 'Beeline'],
]

export const INTERNATIONAL_CARRIERS: CarrierInfo[] = INTERNATIONAL_ENTRIES.map(([mccMnc, cn, en]) => ({
  mccMnc,
  mcc: mccMnc.slice(0, 3),
  mnc: mccMnc.slice(3),
  operatorCn: cn,
  operatorEn: en,
  brand: cn,
  status: '营运中',
}))

// 创建快速查找映射
const carrierMap = new Map<string, CarrierInfo>()
;[...CHINA_CARRIERS, ...GREATER_CHINA_CARRIERS, ...INTERNATIONAL_CARRIERS].forEach((carrier) => {
  carrierMap.set(carrier.mccMnc, carrier)
})

/**
 * 根据 MCC 和 MNC 获取运营商信息
 * @param mcc 移动国家代码
 * @param mnc 移动网络代码
 * @returns 运营商信息或 null
 */
export function getCarrierInfo(mcc: string | number | undefined, mnc: string | number | undefined): CarrierInfo | null {
  if (!mcc || !mnc) return null

  // 标准化 MCC 和 MNC (补零)
  const mccStr = String(mcc).padStart(3, '0')
  const mncStr = String(mnc).padStart(2, '0')
  const mccMnc = `${mccStr}${mncStr}`

  return carrierMap.get(mccMnc) || null
}

/**
 * 格式化运营商显示名称
 * @param mcc 移动国家代码
 * @param mnc 移动网络代码
 * @param showEnglish 是否显示英文名称
 * @returns 格式化的运营商名称
 */
export function formatCarrierName(
  mcc: string | number | undefined,
  mnc: string | number | undefined,
  showEnglish = false
): string {
  const carrier = getCarrierInfo(mcc, mnc)
  
  if (!carrier) {
    // 如果找不到对应的运营商，返回原始 MCC-MNC
    if (mcc && mnc) {
      return `${mcc}-${mnc}`
    }
    return 'Unknown'
  }

  if (showEnglish) {
    return `${carrier.operatorCn} (${carrier.operatorEn})`
  }

  return carrier.operatorCn
}

/**
 * 名称别名兜底表。
 * 模块经 AT+COPS 返回的运营商名是固件原始字符串（如 "CHN-UNICOM"），
 * 且不同固件写法不一致，这里收录常见写法。key 为「规范化名称」（小写、仅保留字母数字）。
 */
const NAME_ALIASES: Record<string, string> = {
  // 中国移动
  chinamobile: '中国移动', cmcc: '中国移动', chnmobile: '中国移动', mobile: '中国移动',
  // 中国联通
  chinaunicom: '中国联通', chnunicom: '中国联通', cucc: '中国联通', unicom: '中国联通',
  // 中国电信
  chinatelecom: '中国电信', chinact: '中国电信', chnct: '中国电信', ctcc: '中国电信',
  // 中国广电
  chinabroadnet: '中国广电', chnbroadnet: '中国广电', chncbn: '中国广电', cbn: '中国广电', cbm: '中国广电', chngbn: '中国广电',
  // 中国铁通
  chinatietong: '中国铁通', tietong: '中国铁通', crtc: '中国铁通',
  // 中国港澳台
  cmhk: '中国香港 中国移动香港', chinamobilehk: '中国香港 中国移动香港',
  smartone: '中国香港 SmarTone', csl: '中国香港 CSL', one2free: '中国香港 1010',
  ctm: '中国澳门 CTM', '3macau': '中国澳门 3 Macau',
  chunghwatelecom: '中国台湾 中华电信', taiwanmobile: '中国台湾 台湾大哥大',
  fareastone: '中国台湾 远传电信', aptelecom: '中国台湾 亚太电信',
}

/**
 * 关键词兜底。顺序敏感：特定词在前，通用词在后，
 * 否则 "Chunghwa Telecom" 会被通用词 telecom 误判成中国电信。
 */
const NAME_HINTS: { tokens: string[]; cn: string }[] = [
  { tokens: ['chunghwa'], cn: '中国台湾 中华电信' },
  { tokens: ['taiwanmobile'], cn: '中国台湾 台湾大哥大' },
  { tokens: ['fareastone'], cn: '中国台湾 远传电信' },
  { tokens: ['chinamobilehk', 'cmhk'], cn: '中国香港 中国移动香港' },
  { tokens: ['smartone'], cn: '中国香港 SmarTone' },
  { tokens: ['chinamobile', 'cmcc', 'chnmobile'], cn: '中国移动' },
  { tokens: ['chinaunicom', 'chnunicom', 'cucc', 'unicom'], cn: '中国联通' },
  { tokens: ['chinatelecom', 'chinact', 'chnct', 'ctcc', 'telecom'], cn: '中国电信' },
  { tokens: ['broadnet', 'cbn'], cn: '中国广电' },
  { tokens: ['tietong'], cn: '中国铁通' },
]

/** 规范化名称：转小写并剔除所有非字母数字字符，便于对抗 "CHN-UNICOM" / "CHN UNICOM" / "CHN_UNICOM" 等变体。 */
function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 拼接 PLMN，mcc 补 3 位、mnc 至少 2 位；mnc 本身为 3 位时不补。 */
function buildPlmn(mcc: string | number | undefined, mnc: string | number | undefined): string | null {
  if (!mcc || !mnc) return null
  const mccStr = String(mcc).padStart(3, '0')
  const mncStr = String(mnc).padStart(2, '0')
  return `${mccStr}${mncStr}`
}

export interface LocalizedOperator {
  /** 用于展示的名称，命中映射时为中文 */
  display: string
  /** 模块返回的原始名称 */
  rawName: string
  /** 是否命中本地映射表；false 表示只能原样显示 */
  matched: boolean
  /** 命中的完整运营商信息（未命中为 null） */
  carrier: CarrierInfo | null
}

/**
 * 把模块返回的运营商名本地化。
 *
 * 优先级：
 * 1. PLMN（MCC+MNC）精确查表 —— 最可靠，固件改名也不受影响
 * 2. 名称精确别名表
 * 3. 名称关键词包含表
 * 4. 全部未命中则原样返回，绝不臆造翻译
 *
 * @param rawName 模块返回的 operator_name / name，如 "CHN-UNICOM"
 * @param mcc 移动国家代码
 * @param mnc 移动网络代码
 */
export function localizeOperator(
  rawName?: string | null,
  mcc?: string | number | null,
  mnc?: string | number | null
): LocalizedOperator {
  const raw = (rawName ?? '').trim()

  const plmn = buildPlmn(mcc ?? undefined, mnc ?? undefined)
  const carrier = plmn ? carrierMap.get(plmn) ?? null : null
  if (carrier) {
    return { display: carrier.operatorCn, rawName: raw, matched: true, carrier }
  }

  if (raw) {
    const key = normalizeName(raw)
    if (key) {
      const exact = NAME_ALIASES[key]
      if (exact) {
        return { display: exact, rawName: raw, matched: true, carrier: null }
      }
      for (const hint of NAME_HINTS) {
        if (hint.tokens.some(token => key.includes(token))) {
          return { display: hint.cn, rawName: raw, matched: true, carrier: null }
        }
      }
    }
  }

  return { display: raw || '未知', rawName: raw, matched: false, carrier: null }
}

/** 只要展示名的便捷包装，等价于 localizeOperator(...).display */
export function operatorDisplayName(
  rawName?: string | null,
  mcc?: string | number | null,
  mnc?: string | number | null
): string {
  return localizeOperator(rawName, mcc, mnc).display
}

/**
 * 获取运营商品牌颜色 (用于 UI 显示)
 * @param mcc 移动国家代码
 * @param mnc 移动网络代码
 * @returns MUI Chip 颜色
 */
export function getCarrierColor(mcc: string | number | undefined, mnc: string | number | undefined): 
  'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' {
  if (!mcc || !mnc) return 'default'
  
  const mccStr = String(mcc)
  const mncStr = String(mnc).padStart(2, '0')
  
  // 中国大陆运营商 (MCC 460)
  if (mccStr === '460') {
    switch (mncStr) {
      // 中国移动: 00, 02, 07, 08 - 绿色
      case '00':
      case '02':
      case '07':
      case '08':
        return 'success'
      // 中国联通: 01, 06, 09 - 红色
      case '01':
      case '06':
      case '09':
        return 'error'
      // 中国电信: 03, 05, 11 - 蓝色
      case '03':
      case '05':
      case '11':
        return 'primary'
      // 中国广电: 15 - 紫色
      case '15':
        return 'secondary'
    }
  }
  
  return 'default'
}

/**
 * 获取运营商 Logo 路径
 * @param mcc 移动国家代码
 * @param mnc 移动网络代码
 * @returns Logo SVG 路径，找不到则返回 null
 */
export function getCarrierLogo(mcc: string | number | undefined, mnc: string | number | undefined): string | null {
  if (!mcc || !mnc) return null
  
  const mccStr = String(mcc)
  const mncStr = String(mnc).padStart(2, '0')
  
  // 中国大陆运营商 (MCC 460)
  if (mccStr === '460') {
    switch (mncStr) {
      // 中国移动: 00, 02, 07, 08
      case '00':
      case '02':
      case '07':
      case '08':
        return '/provider/china-mobile.svg'
      // 中国联通: 01, 06, 09
      case '01':
      case '06':
      case '09':
        return '/provider/china-unicom.svg'
      // 中国电信: 03, 05, 11
      case '03':
      case '05':
      case '11':
        return '/provider/china-telecom.svg'
      // 中国广电: 15
      case '15':
        return '/provider/china-broadnet.svg'
    }
  }
  
  return null
}

