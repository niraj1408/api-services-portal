import LoginPage from '../../pageObjects/login'
import HomePage from '../../pageObjects/home'
import NamespaceAccessPage from '../../pageObjects/namespaceAccess'
import NameSpacePage from '../../pageObjects/namespace'
import MyProfilePage from '../../pageObjects/myProfile'
import ToolBar from '../../pageObjects/toolbar'
import AuthorizationProfile from '../../pageObjects/authProfile'

describe('Revoke Access Manager Role', () => {
  const login = new LoginPage()
  const home = new HomePage()
  const na = new NamespaceAccessPage()

  before(() => {
    cy.visit('/')
    cy.deleteAllCookies()
    cy.reload()
  })

  beforeEach(() => {
    cy.preserveCookies()
    cy.fixture('apiowner').as('apiowner')
    cy.visit(login.path)
  })

  it('authenticates Janis (api owner)', () => {
    cy.get('@apiowner').then(({ user, checkPermission }: any) => {
      cy.login(user.credentials.username, user.credentials.password)
      cy.log('Logged in!')
      home.useNamespace(checkPermission.namespace)
    })
  })

  it('revoke "Namespace.Manager" access to Wendy (access manager)', () => {
    cy.get('@apiowner').then(({ checkPermission }: any) => {
      cy.visit(na.path)
      na.revokePermission(checkPermission.revokePermission.Wendy)
    })
  })

  after(() => {
    cy.logout()
    cy.clearLocalStorage({ log: true })
    cy.deleteAllCookies()
  })
})

describe('Verify that Mark is unable to view the Namespace', () => {

  const login = new LoginPage()
  const home = new HomePage()
  const ns = new NameSpacePage()
  const mp = new MyProfilePage()
  const tb = new ToolBar()
  const authProfile = new AuthorizationProfile()

  before(() => {
    cy.visit('/')
    cy.deleteAllCookies()
    cy.reload()
  })

  beforeEach(() => {
    cy.preserveCookies()
    cy.fixture('credential-issuer').as('credential-issuer')
  })

  it('authenticates Wendy (Credential-Issuer)', () => {
    cy.get('@credential-issuer').then(({ user, checkPermission }: any) => {
      cy.visit(login.path)
      cy.login(user.credentials.username, user.credentials.password)
      cy.log('Logged in!')
      home.useNamespace(checkPermission.namespace)
      cy.visit(mp.path)
    })
  })

  it('Verify that only "CredentialIssuer.Admin" permission is displayed in the profile', () => {
    mp.checkScopeOfProfile("CredentialIssuer.Admin")
  })

  it('Verify that Authorization Profile option is displayed in Namespace page', () => {
    cy.visit(ns.path)
    ns.verifyThatOnlyAuthorizationProfileLinkIsExist()
  })

  it('Verify that authorization profile for Client ID/Secret is generated', () => {
    cy.visit(authProfile.path)
    cy.get('@credential-issuer').then(({ clientCredentials }: any) => {
      let ap = clientCredentials.authProfile
      authProfile.createAuthProfile(ap)
    })
  })

  it('Verify that authorization profile for Kong API key is generated', () => {
    cy.visit(authProfile.path)
    cy.get('@credential-issuer').then(({ kongAPI }: any) => {
      let ap = kongAPI.authProfile
      authProfile.createAuthProfile(ap)
    })
  })

  after(() => {
    cy.logout()
    cy.clearLocalStorage({ log: true })
    cy.deleteAllCookies()
  })
})