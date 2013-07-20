if [ ! -f test/config.json ]; then

echo "Creating default test/config.json"

cat <<EOF > test/config.json
{
  "database": "myapp_test"
  , "username" : "postgres"
}
EOF

fi
