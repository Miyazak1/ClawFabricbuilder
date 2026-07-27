import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopPlanReviewPortError,
  createBuilderDesktopPlanReviewPort,
} from './builderDesktopPlanReviewPort';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174001';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174002';

function request() {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    decision: 'approved' as const,
  };
}

function result() {
  return {
    result_version: 'builder-conversation-plan-review-result.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    decision: 'approved',
    review_admission: 'sqlite_recorded_no_execution',
  };
}

describe('createBuilderDesktopPlanReviewPort', () => {
  it('forwards one plan review request as exact public evidence', async () => {
    const review = vi.fn(async (value: unknown) => {
      void value;
      return result();
    });
    const port = createBuilderDesktopPlanReviewPort({ review });
    const rawRequest = request();

    const reviewed = await port.review(rawRequest);

    expect(review).toHaveBeenCalledExactlyOnceWith(request());
    expect(review.mock.calls[0][0]).not.toBe(rawRequest);
    expect(review.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(review.mock.calls[0][0]).not.toHaveProperty('plan_result_digest');
    expect(reviewed).toEqual(result());
    expect(Object.isFrozen(reviewed)).toBe(true);
  });

  it.each([
    null,
    {},
    { review: async (): Promise<unknown> => null, read: async (): Promise<unknown> => null },
    { approve: async (): Promise<unknown> => null },
  ])('rejects malformed bridge %j', (bridge) => {
    expect(() => createBuilderDesktopPlanReviewPort(bridge)).toThrow(
      BuilderDesktopPlanReviewPortError,
    );
  });

  it('rejects malformed review requests before invoking the bridge', async () => {
    const review = vi.fn(async (value: unknown) => {
      void value;
      return result();
    });
    const port = createBuilderDesktopPlanReviewPort({ review });

    for (const value of [
      null,
      { ...request(), decision: 'accepted' },
      { ...request(), project_id: 'bad' },
      { ...request(), conversation_id: 'builder-conversation:00000000-0000-4000-8000-000000000000' },
      { ...request(), plan_result_digest: `sha256:${'a'.repeat(64)}` },
    ]) {
      await expect(port.review(value as ReturnType<typeof request>)).rejects.toBeInstanceOf(
        BuilderDesktopPlanReviewPortError,
      );
    }
    expect(review).not.toHaveBeenCalled();
  });

  it('rejects result drift and leaked review evidence', async () => {
    for (const value of [
      { ...result(), decision: 'rejected' },
      { ...result(), review_admission: 'sqlite_recorded' },
      { ...result(), plan_result_digest: `sha256:${'a'.repeat(64)}` },
      { ...result(), review_id: 'builder-review:123e4567-e89b-42d3-a456-426614174003' },
    ]) {
      const port = createBuilderDesktopPlanReviewPort({ review: async () => value });
      await expect(port.review(request())).rejects.toBeInstanceOf(
        BuilderDesktopPlanReviewPortError,
      );
    }
  });

  it('redacts hostile bridge responses without invoking accessors', async () => {
    let getterCalls = 0;
    const port = createBuilderDesktopPlanReviewPort({
      review: async () => Object.defineProperty({}, 'result_version', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'never';
        },
      }),
    });

    await expect(port.review(request())).rejects.toBeInstanceOf(
      BuilderDesktopPlanReviewPortError,
    );
    expect(getterCalls).toBe(0);
  });
});
