// PGP Message Loader
//
// Currently for Facebook PGP-encrypted email, this will detect that Facebook
// puts the PGP encrypted document as the second attachment. It will read the
// attachment from disk asynchrnously with background tasks

import fs from 'fs';
import {Utils, FileDownloadStore, MessageBodyProcessor, React} from 'nylas-exports';

import InProcessDecrypter from '../in-process-decrypter';
import WorkerProcessDecrypter from '../worker-process-decrypter';
import FlowError from '../flow-error.es6';

class MessageLoader extends React.Component {
  static displayName = 'MessageLoader'

  static propTypes = {
    message: React.PropTypes.object.isRequired
  }

  // Holds the downloadData (if any) for all of our files. It's a hash
  // keyed by a fileId. The value is the downloadData.
  state = {
    decrypting: false,
    lastError: 0,
    downloads: FileDownloadStore.downloadDataForFiles(this.props.message.fileIds())
  }

  constructor(props) {
    super(props);

    // Array of promises of attachments needed for decryption
    this.pendingReceives = {};

    // All the methods that depend on `this` instance
    this.componentDidMount = this.componentDidMount.bind(this);
    this.componentWillUnmount = this.componentWillUnmount.bind(this);
    this.shouldComponentUpdate = this.shouldComponentUpdate.bind(this);
    this.render = this.render.bind(this);
    this._renderErrorMessage = this._renderErrorMessage.bind(this);
    this._onDownloadStoreChange = this._onDownloadStoreChange.bind(this);
    this._retrievePGPAttachment = this._retrievePGPAttachment.bind(this);
    this._decryptMail = this._decryptMail.bind(this);
  }

  componentDidMount() {
    this._storeUnlisten = FileDownloadStore.listen(this._onDownloadStoreChange);
    this._decryptMail();
  }

  componentWillUnmount() {
    if (this._storeUnlisten) {
      this._storeUnlisten();
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    return !Utils.isEqualReact(nextProps, this.props) ||
           !Utils.isEqualReact(nextState, this.state);
  }

  render() {
    let decrypting = this.state.decrypting && this.props.message.files.length > 0;
    let displayError = this.state.lastError && this.state.lastError.display;

    if (decrypting && !this.props.message.body) {
      return this._renderDecryptingMessage();
    } else if (displayError) {
      return this._renderErrorMessage();
    } else {
      return <span />
    }
  }

  _renderDecryptingMessage() {
    return <div className="statusBox indicatorBox">
      <p>Decrypting message</p>
    </div>
  }

  _renderErrorMessage() {
    return <div className="statusBox errorBox">
      <p><b>Error:</b>{this.state.lastError.message}</p>
    </div>
  }

  _onDownloadStoreChange() {
    let changes = FileDownloadStore.downloadDataForFiles(this.props.message.fileIds());
    Object.keys(changes).forEach((fileId) => {
      let file = changes[fileId];
      if (file.state === 'finished' && this.pendingReceives[file.fileId]) {
        console.log(`Checking ${file.fileId}`);
        // TODO: Dedupe the file reading logic into separate method
        fs.accessAsync(file.targetPath, fs.F_OK | fs.R_OK).then(() => {
          console.log(`Found downloaded attachment ${fileId}`);
          return fs.readFileAsync(file.targetPath, 'utf8').then((text) => {
            this.pendingReceives[file.fileId].resolve(text);
          });
        }, (err) => {
          this.pendingReceives[file.fileId].reject(new FlowError('Downloaded attachment inaccessable', true));
        });
      }
    });
    this.setState({
      downloads: changes
    });
  }

  _getKey() {
    var keyLocation = require('path').join(process.env.HOME, 'pgpkey');
    return fs.readFileAsync(keyLocation, 'utf8');
  }

  _retrievePGPAttachment() {
    var {message} = this.props;
    console.log("Attachments: %d", message.files.length);
    if (message.files.length >= 1) {
      let path = FileDownloadStore.pathForFile(message.files[1]);

      // async fs.exists was throwing because the first argument was true,
      // found fs.access as a suitable replacement
      return fs.accessAsync(path, fs.F_OK | fs.R_OK).then(() => {
        return fs.readFileAsync(path, 'utf8').then((text) => {
          console.log("Read attachment from disk");
          return text;
        });
      }, (err) => {
        console.log('Attachment file inaccessable, creating pending promise');
        return new Promise((resolve, reject) => {
          if (this.pendingReceives[message.files[1].id]) {
            return this.pendingReceives[message.files[1].id];
          } else {
            this.pendingReceives[message.files[1].id] = { resolve, reject };
          }
        });
        //throw new Error("Attachment file inaccessable");
      });
    } else {
      throw new FlowError("No attachments");
    }
  }

  // Retrieves the attachment and encrypted secret key for code divergence later
  _getAttachmentAndKey() {
    return new Promise((resolve) => {
      resolve([ this._retrievePGPAttachment(), this._getKey() ]);
    }).spread((text, pgpkey) => {
      if (!text) {
        throw new Error("No text in attachment");
      }
      if (!pgpkey) {
        throw new Error("No key in pgpkey variable");
      }
      return [text, pgpkey];
    });
  }

  _selectDecrypter() {
    const chosen = "WORKER_PROCESS";
    var decrypter = InProcessDecrypter; // IN_PROCESS

    if (chosen === "WORKER_PROCESS") {
      decrypter = WorkerProcessDecrypter;
    }

    return new decrypter().decrypt;
  }

  _extractHTML(text) {
    let start = process.hrtime();
    let matches = /\n--[^\n\r]*\r?\nContent-Type: text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)\n\r?\n--/gim.exec(text);
    let end = process.hrtime(start);
    if (matches) {
      console.log(`%cHTML found in decrypted: ${end[0] * 1e3 + end[1] / 1e6}ms`, "color:blue");
      return matches[1];
    } else {
      throw new FlowError("no HTML found in decrypted");
    }
  }

  // The main brains of this project. This retrieves the attachment and secret
  // key (someone help me find a (secure) way to store the secret key) in
  // parallel. We parse the HTML out of the content, then update the state which
  // triggers a page update
  _decryptMail() {
    window.loader = this;

    console.group(`[PGP] Message: ${this.props.message.id}`);

    this.setState({ decrypting: true });

    let decrypter = this._selectDecrypter();
    let startDecrypt = process.hrtime();
    this._getAttachmentAndKey().spread(decrypter).then((text) => {
      let endDecrypt = process.hrtime(startDecrypt);
      console.log(`%cTotal message decrypt time: ${endDecrypt[0] * 1e3 + endDecrypt[1] / 1e6}ms`, "color:blue");
      return text;
    }).then(this._extractHTML).then((match) => {
      this.props.message.body = match;
      MessageBodyProcessor.resetCache();
      this.setState({ decrypting: false });
    }).catch((error) => {
      if (error instanceof FlowError) {
        console.log(error.title);
      } else {
        console.log(error.stack);
      }
      this.setState({
        decrypting: false,
        lastError: error
      });
    }).finally(() => {
      console.groupEnd();
    });
  }
}

export default MessageLoader;