## TESTS

TESTER = ./node_modules/.bin/mocha
OPTS = --require ./test/init.js
TESTS = test/*.test.js

test:
	./defaultConfig.sh
	$(TESTER) $(OPTS) $(TESTS)
test-verbose:
	./defaultConfig.sh
	$(TESTER) $(OPTS) --reporter spec $(TESTS)
testing:
	./defaultConfig.sh
	$(TESTER) $(OPTS) --watch $(TESTS)

.PHONY: test docs
