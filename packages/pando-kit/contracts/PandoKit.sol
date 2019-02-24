pragma solidity ^0.4.24;

import "@aragon/os/contracts/lib/ens/ENS.sol";
import "@aragon/os/contracts/lib/ens/PublicResolver.sol";
import "@aragon/os/contracts/apm/Repo.sol";
import "@aragon/os/contracts/apm/APMNamehash.sol";
import "@aragon/os/contracts/factory/DAOFactory.sol";
import "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";
import "@aragon/apps-vault/contracts/Vault.sol";
import "@aragon/apps-finance/contracts/Finance.sol";
import "@aragon/apps-voting/contracts/Voting.sol";
import "@pando/colony/contracts/PandoColony.sol";
import { TokenManager } from "@aragon/apps-token-manager/contracts/TokenManager.sol";


contract KitBase is APMNamehash {
    ENS        public ens;
    DAOFactory public fac;

    event DeployInstance(address dao);
    event InstalledApp(address appProxy, bytes32 appId);

    constructor(DAOFactory _fac, ENS _ens) public {
        ens = _ens;

        // If no factory is passed, get it from on-chain bare-kit
        if (address(_fac) == address(0)) {
            bytes32 bareKit = apmNamehash("bare-kit");
            fac = KitBase(latestVersionAppBase(bareKit)).fac();
        } else {
            fac = _fac;
        }
    }

    function latestVersionAppBase(bytes32 appId) public view returns (address base) {
        Repo repo = Repo(PublicResolver(ens.resolver(appId)).addr(appId));
        (,base,) = repo.getLatest();

        return base;
    }
}


contract PandoKit is KitBase {
    MiniMeTokenFactory tokenFactory;

    uint256 constant PCT = 10 ** 16;
    address constant ANY_ENTITY = address(-1);

    constructor(ENS ens) public KitBase(DAOFactory(0), ens) {
        tokenFactory = new MiniMeTokenFactory();
    }

    function newInstance() external {
        bytes32[5] memory appIds = [
            apmNamehash("vault"),            // 0
            apmNamehash("finance"),          // 1
            apmNamehash("token-manager"),    // 2
            apmNamehash("voting"),           // 3
            apmNamehash("pando-colony")      // 4
        ];

        Kernel dao = fac.newDAO(this);
        ACL    acl = ACL(dao.acl());
        acl.createPermission(this, dao, dao.APP_MANAGER_ROLE(), this);

        // Token
        MiniMeToken token = tokenFactory.createCloneToken(MiniMeToken(address(0)), 0, "Native Governance Token", 0, "NGT", true);
        token.generateTokens(msg.sender, 1);

        // Apps
        Vault vault = Vault(
            dao.newAppInstance(
                appIds[0],
                latestVersionAppBase(appIds[0]),
                new bytes(0),
                true
            )
        );
        emit InstalledApp(vault, appIds[0]);

        Finance finance = Finance(
            dao.newAppInstance(
                appIds[1],
                latestVersionAppBase(appIds[1])
            )
        );
        emit InstalledApp(finance, appIds[1]);

        TokenManager tokenManager = TokenManager(
            dao.newAppInstance(
                appIds[2],
                latestVersionAppBase(appIds[2])
            )
        );
        emit InstalledApp(tokenManager, appIds[2]);

        Voting metavoting = Voting(
            dao.newAppInstance(
                appIds[3],
                latestVersionAppBase(appIds[3])
            )
        );
        emit InstalledApp(metavoting, appIds[3]);

        PandoColony colony = PandoColony(
            dao.newAppInstance(
                appIds[4],
                latestVersionAppBase(appIds[4])
            )
        );
        emit InstalledApp(colony, appIds[4]);

        // Permissions
        acl.grantPermission(colony, dao, dao.APP_MANAGER_ROLE());
        acl.grantPermission(colony, acl, acl.CREATE_PERMISSIONS_ROLE());
        acl.createPermission(finance, vault, vault.TRANSFER_ROLE(), metavoting);
        acl.createPermission(metavoting, finance, finance.CREATE_PAYMENTS_ROLE(), metavoting);
        acl.createPermission(metavoting, finance, finance.EXECUTE_PAYMENTS_ROLE(), metavoting);
        acl.createPermission(metavoting, finance, finance.MANAGE_PAYMENTS_ROLE(), metavoting);
        acl.createPermission(colony, tokenManager, tokenManager.MINT_ROLE(), metavoting);
        acl.createPermission(metavoting, tokenManager, tokenManager.ISSUE_ROLE(), metavoting);
        acl.createPermission(metavoting, tokenManager, tokenManager.ASSIGN_ROLE(), metavoting);
        acl.createPermission(metavoting, tokenManager, tokenManager.REVOKE_VESTINGS_ROLE(), metavoting);
        acl.createPermission(metavoting, tokenManager, tokenManager.BURN_ROLE(), metavoting);
        acl.createPermission(ANY_ENTITY, metavoting, metavoting.CREATE_VOTES_ROLE(), metavoting);
        acl.createPermission(ANY_ENTITY, colony, colony.CREATE_REPOSITORY_ROLE(), metavoting);

        EVMScriptRegistry reg = EVMScriptRegistry(acl.getEVMScriptRegistry());
        acl.createPermission(metavoting, reg, reg.REGISTRY_ADD_EXECUTOR_ROLE(), metavoting);
        acl.createPermission(metavoting, reg, reg.REGISTRY_MANAGER_ROLE(), metavoting);


        // Initialize apps
        token.changeController(tokenManager);
        vault.initialize();
        finance.initialize(vault, 30 days);
        tokenManager.initialize(token, true, 0);
        metavoting.initialize(token, uint64(50 * PCT), uint64(20 * PCT), 1 days);
        colony.initialize(ens);

        // Cleanup permissions
        acl.grantPermission(metavoting, dao, dao.APP_MANAGER_ROLE());
        acl.revokePermission(this, dao, dao.APP_MANAGER_ROLE());
        acl.setPermissionManager(metavoting, dao, dao.APP_MANAGER_ROLE());

        acl.grantPermission(metavoting, acl, acl.CREATE_PERMISSIONS_ROLE());
        acl.revokePermission(this, acl, acl.CREATE_PERMISSIONS_ROLE());
        acl.setPermissionManager(metavoting, acl, acl.CREATE_PERMISSIONS_ROLE());

        emit DeployInstance(dao);
    }
}
