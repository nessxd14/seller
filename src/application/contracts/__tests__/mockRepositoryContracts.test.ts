import { VersionedLocalRepository } from '../../../infrastructure/mock/VersionedLocalRepository'
import { runCashRepositoryContractTests, runCustomerRepositoryContractTests, runOrderRepositoryContractTests, runProductRepositoryContractTests, runQuoteRepositoryContractTests, runSaleRepositoryContractTests } from '../repositoryContractTests'

const factory=(prefix:string)=>()=>({repository:new VersionedLocalRepository<{id:string;name:string}>(),create:()=>({id:`${prefix}-1`,name:`${prefix} mock`})})
runQuoteRepositoryContractTests(factory('quote'))
runProductRepositoryContractTests(factory('product'))
runOrderRepositoryContractTests(factory('order'))
runSaleRepositoryContractTests(factory('sale'))
runCashRepositoryContractTests(factory('cash'))
runCustomerRepositoryContractTests(factory('customer'))
