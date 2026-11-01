import { describe, expect, it } from 'vitest';
import { suggestPromotion, type PromotionClass } from '../../src/domain/promotions';

const classSequence: PromotionClass[] = [
  { id: 'ss2', name: 'SS 2', level: 'SS', active: true, next_class_id: 'ss3' },
  { id: 'ss3', name: 'SS 3', level: 'SS', active: true, next_class_id: null },
  { id: 'p1', name: 'Primary 1', level: 'Primary', active: true, next_class_id: 'p2' },
  { id: 'p2', name: 'Primary 2', level: 'Primary', active: true, next_class_id: null },
  { id: 'ss2-legacy', name: 'SS 2 Legacy', level: 'SS', active: true, next_class_id: 'ss3-inactive' },
  { id: 'ss3-inactive', name: 'SS 3 Legacy', level: 'SS', active: false, next_class_id: null },
];

const classesById = new Map(classSequence.map((schoolClass) => [schoolClass.id, schoolClass]));

describe('suggestPromotion', () => {
  it('recommends the configured next class for a learner with a successor', () => {
    expect(suggestPromotion(classSequence[0], classesById)).toEqual({
      kind: 'normal',
      destination_class_id: 'ss3',
      reason: 'End-of-session normal promotion',
    });
  });

  it('recommends graduation at the end of the senior secondary sequence', () => {
    expect(suggestPromotion(classSequence[1], classesById)).toEqual({
      kind: 'graduation',
      destination_class_id: '',
      reason: 'End-of-session graduation',
    });
  });

  it('requires review rather than assuming graduation for other terminal classes', () => {
    expect(suggestPromotion(classSequence[3], classesById)).toEqual({
      kind: 'special_placement',
      destination_class_id: '',
      reason: 'End-of-session placement review',
    });
  });

  it('requires review when the configured next class is inactive', () => {
    expect(suggestPromotion(classSequence[4], classesById)).toEqual({
      kind: 'special_placement',
      destination_class_id: '',
      reason: 'End-of-session placement review',
    });
  });
});
