// Shared community entry points. QQ uses the official group-card deep link so
// only the public group number is sent, without invite credentials.
export const COMMUNITY_LINKS = {
  qq: 'mqqapi://card/show_pslcard?uin=1012639381&card_type=group',
  qqGroup: '1012639381',
  github: 'https://github.com/wssfk12138/android-english-multiple-choice-practice-machine',
} as const
