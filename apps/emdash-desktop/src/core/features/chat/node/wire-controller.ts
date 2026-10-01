import { createController, type Controller } from '@emdash/wire/rpc';
import { chatContract } from '../api';
import { prepareChatFolder } from './chat-service';

export function createChatWireController(): Controller {
  return createController(chatContract, {
    prepareFolder: () => prepareChatFolder(),
  });
}
