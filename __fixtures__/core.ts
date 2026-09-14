import type * as core from '@actions/core';
import { jest } from '@jest/globals';

/** Mock of `@actions/core` in the style of actions/typescript-action. */
export const debug = jest.fn<typeof core.debug>();
export const error = jest.fn<typeof core.error>();
export const info = jest.fn<typeof core.info>();
export const notice = jest.fn<typeof core.notice>();
export const warning = jest.fn<typeof core.warning>();
export const getInput = jest.fn<typeof core.getInput>();
export const setOutput = jest.fn<typeof core.setOutput>();
export const setSecret = jest.fn<typeof core.setSecret>();
export const setFailed = jest.fn<typeof core.setFailed>();

export const summaryWrites: string[] = [];
export const summary = {
  addRaw(text: string) {
    summaryWrites.push(text);
    return summary;
  },
  async write() {
    return summary;
  },
};
