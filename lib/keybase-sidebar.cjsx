{Utils,
 React,
 FocusedContactsStore,
 MessageStore} = require 'nylas-exports'
{RetinaImg} = require 'nylas-component-kit'
Keybase = new (require './keybase/keybase-integration')
_ = require('underscore')
EmailPGPStore = require('./email-pgp-store');
EventProcessor = require('./worker/event-processor')
proto = require('./worker/worker-protocol')
WorkerFrontend = require('./worker-frontend')

# TODO: Recode this in es6.
class KeybaseSidebar extends React.Component
  @displayName: 'KeybaseSidebar'

  # Providing container styles tells the app how to constrain
  # the column your component is being rendered in. The min and
  # max size of the column are chosen automatically based on
  # these values.
  @containerStyles:
    order: 1
    flexShrink: 0

  # This sidebar component listens to the FocusedContactStore,
  # which gives us access to the Contact object of the currently
  # selected person in the conversation. If you wanted to take
  # the contact and fetch your own data, you'd want to create
  # your own store, so the flow of data would be:
  #
  # FocusedContactStore => Your Store => Your Component
  #
  constructor: (@props) ->
    @state = @_getStateFromStores()
    @state.data = null

  getMessage: =>
    console.log MessageStore.items()
    return MessageStore.items()[0]

  componentDidMount: =>
    @unsubscribe = FocusedContactsStore.listen(@_onChange)

    msg = @getMessage()

    if EmailPGPStore.shouldDecryptMessage msg
      self = this

      notify = (msg) ->
        console.log(msg)

      decrypter = WorkerFrontend.decrypt.bind null, notify

      (EmailPGPStore._getAttachmentAndKey msg, notify).spread(decrypter).then (result) ->
        if result.signedBy?
          (Keybase.userLookup { key_fingerprint: [result.signedBy], fields: ['basics', 'proofs_summary', 'cryptocurrency_addresses'] }).then (res) ->
            self.setState {
              data: res.them[0].proofs_summary,
              name: res.them[0].basics.username,
              profile: res.them[0].profile,
              cryptoaddress: res.them[0].cryptocurrency_addresses,
              fpr: result.signedBy
            }

  componentWillUnmount: =>
    @unsubscribe()

  render: =>
    msg = @getMessage()

    if not EmailPGPStore.shouldDecryptMessage msg
      return <span></span>

    if @state.contact
      content = @_renderContent()
    else
      content = @_renderPlaceholder()


    <div className="contact-card-fullcontact">
      {content}
    </div>

  _proofs: =>
    _.map @state.data.by_presentation_group, (proofs, site) ->
      icon = switch
        when site is 'twitter' then 'twitter'
        when site is 'github' then 'github'
        when site is 'reddit' then 'reddit'
        when site is 'hackernews' then 'hackernews'
        else 'globe'

      for proof in proofs
        if proofs[1]?.presentation_tag is 'dns' and proof.presentation_tag is 'dns'
          break

        <div className="social-profile">
          <i className="social-icon fa fa-#{icon}" style={ marginTop: 2, minWidth: '1em' }></i>

          <div className="social-link">
            <a href=proof.proof_url>{proof.nametag}</a>
          </div>
        </div>

  _cryptocoins: =>
    _.map @state.cryptoaddress, (data, type) ->
      icon = switch
        when type is 'bitcoin' then 'btc'
        else 'question-circle'

      for address in data
        <div className="social-profile">
          <i className="social-icon fa fa-#{icon}" style={ marginTop: 2, minWidth: '1em' }></i>

          <div className="social-link">
            {address.address}
          </div>
        </div>

  _renderContent: =>
    # Want to include images or other static assets in your components?
    # Reference them using the nylas:// URL scheme:
    #
    # <RetinaImg
    #    url="nylas://<<package.name>>/assets/checkmark_template@2x.png"
    #    mode={RetinaImg.Mode.ContentIsMask}/>
    #
    if not @state.data
      return @_renderPlaceholder()

    proofs = @_proofs()
    coins = @_cryptocoins()

    console.log coins

    <div className="header">
      <a href="https://keybase.io/#{@state.name}" style={textDecoration: 'none'}><h1 className="name">Keybase</h1></a>

      <div className="social-profiles">
        {proofs}
        {coins}
      </div>
    </div>

  _renderPlaceholder: =>
    <div className="header">
      <h1 className="name">Keybase</h1>

      <div className="social-profiles">
        <div className="social-profile">Loading...</div>
      </div>
    </div>

  _onChange: =>
    @setState(@_getStateFromStores())

  _getStateFromStores: =>
    contact: FocusedContactsStore.focusedContact()


module.exports = KeybaseSidebar
