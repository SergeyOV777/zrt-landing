const LANDING_TAG = 'adv.zrt-school.ru';
const OFFER_TAG = '1000оффер';
const CAMPAIGN_TAG = 'Директ_РСЯ_Лендинги';

export function buildAmoLeadTags(scenario) {
  return [
    { name: LANDING_TAG },
    { name: `Форма: ${scenario}` },
    { name: OFFER_TAG },
    { name: CAMPAIGN_TAG }
  ];
}
