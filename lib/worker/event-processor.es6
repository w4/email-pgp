import uuid from 'uuid';

import {log} from './logger';
import proto from './worker-protocol';
import KbpgpDecryptController from './kbpgp/kbpgp-decrypt';

class EventProcessor {
  constructor() {
    this._pendingPromises = {};

    this._kbpgpDecryptController = new KbpgpDecryptController(this);

    this.requestPassphrase = this.requestPassphrase.bind(this);
    this._sendError = this._sendError.bind(this);
    this._handleDecryptMessage = this._handleDecryptMessage.bind(this);
    this._onFrontendMessage = this._onFrontendMessage.bind(this);

    process.on('message', this._onFrontendMessage);
  }

  requestPassphrase(message) {
    let id = uuid();

    return new Promise((resolve, reject) => {
      this._pendingPromises[id] = {resolve, reject};
      process.send({ method: proto.REQUEST_PASSPHRASE, id, message });
    });
  }

  _sendError(err) {
    process.send({ method: proto.ERROR_OCCURRED, err: err, errorMessage: err.message, errorStackTrace: err.stack });
  }

  _handleDecryptMessage(message) {
    let {id} = message;
    let notify = (result) => {
      process.send({ method: proto.PROMISE_NOTIFY, id, result });
    }

    this._kbpgpDecryptController.decrypt(message, notify).then(({literals, elapsed}) => {
      let ref;
      let ref1;
      let signedBy = (((ref = (((ref1 = literals[0].get_data_signer()) != null) ? ref1.get_key_manager() : undefined)) != null) ? ref.get_pgp_fingerprint() : undefined).toString('hex');
      process.send({ method: proto.DECRYPTION_RESULT, id, result: { text: literals[0].toString(), signedBy: signedBy }, elapsed });
    }).catch((err) => {
      //this._sendError(err);
      process.send({ method: proto.PROMISE_REJECT, id, result: err.message });
    });
  }

  _onFrontendMessage(message) {
    if (message.method === proto.DECRYPT) {
      // DECRYPT
      this._handleDecryptMessage(message);
    } else if (message.method === proto.PROMISE_RESOLVE && this._pendingPromises[message.id]) {
      // PROMISE_RESOLVE
      this._pendingPromises[message.id].resolve(message.result);
      delete this._pendingPromises[message.id];
    } else if (message.method === proto.PROMISE_REJECT && this._pendingPromises[message.id]) {
      // PROMISE_REJECT
      this._pendingPromises[message.id].reject(message.result);
      delete this._pendingPromises[message.id];
    } else if (message.method === proto.LIST_PENDING_PROMISES) {
      // LIST_PENDING_PROMISES
      log(JSON.stringify(this._pendingPromises));
      log(JSON.stringify(this._kbpgpDecryptController._waitingForPassphrase));
    }
  }
}

export default new EventProcessor();
